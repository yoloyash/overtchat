import { createHash } from "node:crypto";
import type {
  AgentDaemonRequest,
  AgentDaemonSessionDescriptor,
  AgentDaemonTarget,
  AgentDaemonWorkspaceDescriptor,
  AgentPromptImage,
  AgentRuntimeEnvelope,
  AgentRuntimeStatus,
  HostConnectorCommand,
  HostConnectorEventPayload,
} from "@overtchat/agent-bridge";
import {
  isAgentProviderNotice,
  parseHostConnectorCapabilities,
} from "@overtchat/agent-bridge";
import {
  AgentRuntimeRegistry,
  AgentProviderCatalogManager,
  AgentProviderSnapshotManager,
  agentProviderAdapter,
  configureProcessSpawner,
  configureTcpTunnelOpener,
  inspectAgentWorkspaceGitStatus,
  listAgentDirectories,
  probeAgentWorkspace,
  workspaceFilesService,
  type AgentSessionRuntime,
  type HostTarget,
  type ResolvedAgentImage,
} from "@overtchat/agent-runtime";
import { listSshHosts } from "./ssh.js";
import { ConnectorProcessHost } from "./runtime.js";
import { ConnectorStateJournal } from "./state.js";
import { ConnectorTimelineStore } from "./timeline.js";

type Emit = (event: HostConnectorEventPayload) => void;
type ResolveImages = (
  images: readonly AgentPromptImage[],
) => Promise<ResolvedAgentImage[]>;

type TimelineCapture = {
  runtime: AgentSessionRuntime;
  providerSessionId: string;
  providerSessionPath: string;
  ready: Promise<void>;
  initialized: boolean;
  buffered: AgentRuntimeEnvelope[];
  pending: Set<Promise<AgentRuntimeEnvelope | null>>;
  unsubscribe: () => void;
  failure?: Error;
};

type SessionSubscription = {
  sessionId: string;
  unsubscribeTimeline: () => void;
  releaseRuntime: () => void;
};

const SHUTDOWN_GRACE_MS = 5_000;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function commandFingerprint(
  request: Extract<AgentDaemonRequest, { type: "session_command" }>,
): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        sessionId: request.session.sessionId,
        clientMessageId: request.clientMessageId,
        command: request.command,
      }),
    )
    .digest("hex");
}

function unknownCommandOutcome(error?: unknown): Error {
  const detail = error ? ` ${errorMessage(error)}` : "";
  return new Error(
    `The command may already have been accepted, so OvertChat will not replay it automatically. Inspect the session before trying different work.${detail}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hostTarget(target: AgentDaemonTarget): HostTarget {
  return target.transport === "local"
    ? { transport: "local", shellMode: target.shellMode }
    : {
        transport: "ssh",
        alias: target.alias,
        shellMode: target.shellMode,
      };
}

function workspaceDescriptor(
  descriptor: AgentDaemonWorkspaceDescriptor,
) {
  return {
    ...descriptor,
    target: hostTarget(descriptor.target),
  };
}

function sessionDescriptor(descriptor: AgentDaemonSessionDescriptor) {
  return {
    ...descriptor,
    target: hostTarget(descriptor.target),
  };
}

export class ConnectorDaemon {
  private readonly processHost = new ConnectorProcessHost();
  private readonly providerSnapshots = new AgentProviderSnapshotManager();
  private readonly providerCatalogs = new AgentProviderCatalogManager();
  private readonly registry: AgentRuntimeRegistry;
  private readonly subscriptions = new Map<string, SessionSubscription>();
  private readonly captures = new Map<string, TimelineCapture>();
  private readonly publishedSessions = new Map<
    string,
    AgentRuntimeStatus
  >();
  private readonly sessionTails = new Map<string, Promise<void>>();
  private readonly activeRequests = new Set<Promise<void>>();
  private readonly shutdownAbort = new AbortController();
  private readonly serverCapabilities = new Set<string>();
  private connectionEpoch: string | null = null;
  private accepting = true;
  private storesClosing = false;

  constructor(
    private readonly emit: Emit,
    resolveImages: ResolveImages,
    private readonly journal: ConnectorStateJournal,
    private readonly timelines: ConnectorTimelineStore,
    private readonly fail: (error: Error) => void = () => {},
    private readonly shutdownGraceMs = SHUTDOWN_GRACE_MS,
  ) {
    configureProcessSpawner(this.processHost.spawn);
    configureTcpTunnelOpener(this.processHost.openTcpTunnel);
    this.registry = new AgentRuntimeRegistry({
      resolveImages,
      updateSessionMetadata: async (sessionId, patch) => {
        const { providerModifiedAt, ...metadata } = patch;
        if (patch.launchConfig) {
          await this.journal.updateSessionLaunchConfig(
            sessionId,
            patch.launchConfig,
          );
        }
        this.emit({
          type: "session_metadata",
          sessionId,
          patch: {
            ...metadata,
            ...(providerModifiedAt
              ? { providerModifiedAt: providerModifiedAt.getTime() }
              : {}),
          },
        });
      },
      loadQueuedMessages: (sessionId) => this.journal.sessionQueue(sessionId),
      saveQueuedMessages: (sessionId, messages) =>
        this.journal.saveSessionQueue(sessionId, messages),
      runtimeExited: (sessionId, runtime) => {
        void this.retireRuntime(sessionId, runtime).catch((error) => {
          console.error(
            `Unable to retire the ${sessionId} session runtime: ${errorMessage(error)}`,
          );
        });
      },
      resolveCatalog: (descriptor) =>
        this.providerCatalogs.getCatalog(descriptor),
    });
  }

  handle(command: HostConnectorCommand): Promise<void> {
    if (!this.accepting) return Promise.resolve();
    const operation = this.dispatch(command);
    this.activeRequests.add(operation);
    const remove = () => this.activeRequests.delete(operation);
    void operation.then(remove, remove);
    return operation;
  }

  private async dispatch(command: HostConnectorCommand): Promise<void> {
    if (command.type === "sync") {
      await this.beginConnection(
        command.connectionEpoch,
        command.activeSessionIds,
        command.serverInfo?.capabilities ?? [],
      );
      return;
    }
    const startedAt = Date.now();
    try {
      const data = await this.handleRequest(command.request);
      this.emit({
        type: "response",
        requestId: command.requestId,
        success: true,
        data,
      });
    } catch (error) {
      this.emit({
        type: "response",
        requestId: command.requestId,
        success: false,
        error: errorMessage(error),
      });
    } finally {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= 250) {
        console.info(
          `[connector:timing] request type=${command.request.type} elapsed_ms=${elapsedMs}`,
        );
      }
    }
  }

  async stop(): Promise<void> {
    this.accepting = false;
    if (!(await this.waitForActiveRequests(this.shutdownGraceMs))) {
      // The write-ahead command entry is already durable. Unblock the daemon's
      // request wrapper without pretending a provider outcome is known, then
      // stop the provider below. Late provider settlement has no daemon
      // continuation and therefore cannot touch closing stores.
      this.shutdownAbort.abort();
      await this.waitForActiveRequests(this.shutdownGraceMs);
    }
    // From this point on, an accepted request that outlived both grace periods
    // may finish its provider operation, but it must not start another journal
    // or timeline operation. The stores are closed by the client immediately
    // after this method returns.
    this.storesClosing = true;
    for (const subscription of this.subscriptions.values()) {
      this.closeSubscription(subscription);
    }
    this.subscriptions.clear();
    // Calling finishCapture freezes every observer synchronously before the
    // registry is told to stop, so provider shutdown cannot publish a fake
    // `exited` state into the durable timeline. The asynchronous drains and
    // provider stops then share one final bounded grace period.
    const captureCleanup = Promise.all(
      [...this.captures.keys()].map((sessionId) =>
        this.finishCapture(sessionId, false),
      ),
    ).then(() => undefined);
    const runtimeCleanup = this.registry.stopAll();
    const [captureOutcome, runtimeOutcome] = await Promise.all([
      this.settleWithin(captureCleanup, this.shutdownGraceMs),
      this.settleWithin(runtimeCleanup, this.shutdownGraceMs),
    ]);
    this.processHost.stop();
    const failure = [captureOutcome, runtimeOutcome].find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome?.status === "rejected",
    )?.reason;
    if (failure) throw failure;
  }

  private async waitForActiveRequests(milliseconds: number): Promise<boolean> {
    if (this.activeRequests.size === 0) return true;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), milliseconds);
      timer.unref();
    });
    const settled = Promise.allSettled([...this.activeRequests]).then(
      () => true as const,
    );
    const result = await Promise.race([settled, timeout]);
    if (timer) clearTimeout(timer);
    return result;
  }

  private async settleWithin(
    operation: Promise<void>,
    milliseconds: number,
  ): Promise<PromiseSettledResult<void> | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), milliseconds);
      timer.unref();
    });
    const settled = operation.then<
      PromiseFulfilledResult<void>,
      PromiseRejectedResult
    >(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    );
    const result = await Promise.race([settled, timeout]);
    if (timer) clearTimeout(timer);
    return result;
  }

  private async beginConnection(
    connectionEpoch: string,
    activeSessionIds: string[],
    serverCapabilities: string[],
  ): Promise<void> {
    this.serverCapabilities.clear();
    for (const capability of parseHostConnectorCapabilities(
      serverCapabilities.join(","),
    )) {
      this.serverCapabilities.add(capability);
    }
    if (this.connectionEpoch !== connectionEpoch) {
      this.connectionEpoch = connectionEpoch;
      this.publishedSessions.clear();
      for (const subscription of this.subscriptions.values()) {
        this.closeSubscription(subscription);
      }
      this.subscriptions.clear();
    }
    const active = new Set(activeSessionIds);
    const removed = this.journal
      .sessionIds()
      .filter((sessionId) => !active.has(sessionId));
    await Promise.all(
      removed.map((sessionId) => this.registry.stopSession(sessionId)),
    );
    this.assertAccepting();
    await Promise.all(
      removed.map((sessionId) => this.finishCapture(sessionId, true)),
    );
    this.assertAccepting();
    await this.journal.retainSessions(active);
    this.publishSessionDirectory(active);
  }

  private async handleRequest(request: AgentDaemonRequest): Promise<unknown> {
    switch (request.type) {
      case "list_ssh_hosts":
        return listSshHosts();
      case "provider_snapshot":
        return this.providerSnapshots.getSnapshot(request.target, {
          refresh: request.refresh,
        });
      case "probe":
        return agentProviderAdapter(request.draft.provider).probeConnection(
          request.draft,
        );
      case "list_sessions": {
        const workspace = workspaceDescriptor(request.workspace);
        return agentProviderAdapter(workspace.provider).listWorkspaceSessions(
          workspace.target,
          workspace.executable,
          workspace.cwd,
        );
      }
      case "get_catalog": {
        const workspace = workspaceDescriptor(request.workspace);
        return this.providerCatalogs.getCatalog(workspace);
      }
      case "list_directories":
        return listAgentDirectories(hostTarget(request.target), request.path);
      case "probe_workspace":
        return probeAgentWorkspace(hostTarget(request.target), request.path);
      case "git_status":
        return inspectAgentWorkspaceGitStatus(
          hostTarget(request.target),
          request.path,
        );
      case "list_workspace_directory":
        return workspaceFilesService.listDirectory(
          hostTarget(request.target),
          request.root,
          request.path,
        );
      case "read_workspace_file":
        return workspaceFilesService.readFile(
          hostTarget(request.target),
          request.root,
          request.path,
        );
      case "create_session": {
        const workspace = workspaceDescriptor(request.workspace);
        const created = await this.serializeSession(request.sessionId, async () => {
          let result;
          try {
            result = await this.registry.create(
              request.sessionId,
              workspace,
              request.launchConfig,
            );
          } catch (error) {
            this.providerCatalogs.invalidate(workspace);
            throw error;
          }
          await this.assertRuntimeAccepted(request.sessionId);
          await this.journal.recordSession({
            ...request.workspace,
            sessionId: request.sessionId,
            providerSessionId: result.session.providerSessionId,
            providerSessionPath: result.session.providerSessionPath,
            launchConfig: result.launchConfig,
          });
          await this.assertRuntimeAccepted(request.sessionId);
          await this.attachTimeline(
            result.runtime,
            result.session.providerSessionId,
            result.session.providerSessionPath,
          );
          await this.assertRuntimeAccepted(request.sessionId);
          return result;
        });
        this.assertAccepting();
        const sync = await this.timelines.sync(request.sessionId);
        return {
          session: created.session,
          launchConfig: created.launchConfig,
          snapshot: sync.reset ? sync.snapshot : created.runtime.snapshot(),
          ...(this.serverCapabilities.has("session-sync-v1") ? { sync } : {}),
        };
      }
      case "open_session": {
        const runtime = await this.open(request.session);
        this.assertAccepting();
        const sync = await this.timelines.sync(
          request.session.sessionId,
          request.after,
        );
        return {
          snapshot: sync.reset ? sync.snapshot : runtime.snapshot(),
          ...(this.serverCapabilities.has("session-sync-v1") ? { sync } : {}),
        };
      }
      case "restart_session":
        return this.serializeSession(request.session.sessionId, async () => {
          // Freeze the old runtime's timeline before stopping it so its
          // synthetic exit snapshot cannot briefly replace the resumed state.
          await this.finishCapture(request.session.sessionId, false);
          this.assertAccepting();
          await this.registry.stopSession(request.session.sessionId);
          this.assertAccepting();
          const runtime = await this.openRuntime(request.session);
          return { restarted: true, snapshot: runtime.snapshot() };
        });
      case "session_command":
        if (request.command.type === "show_usage") {
          const runtime =
            this.registry.get(request.session.sessionId) ??
            (await this.open(request.session));
          return {
            commandResult: await runtime.command({ type: "show_usage" }),
          };
        }
        return this.runCommand(request);
      case "subscribe_session": {
        const previous = this.subscriptions.get(request.subscriptionId);
        if (previous) {
          this.closeSubscription(previous);
          this.subscriptions.delete(request.subscriptionId);
        }
        const runtime = await this.open(request.session);
        this.assertAccepting();
        const subscriber = (envelope: AgentRuntimeEnvelope) => {
          this.emit({
            type: "session_event",
            subscriptionId: request.subscriptionId,
            sessionId: request.session.sessionId,
            envelope,
          });
        };
        const { sync, unsubscribe } = await this.timelines.subscribe(
          request.session.sessionId,
          request.after,
          subscriber,
        );
        if (!this.accepting) {
          unsubscribe();
          throw new Error("The Host Connector is shutting down.");
        }
        const releaseRuntime = runtime.acquireLease();
        this.subscriptions.set(request.subscriptionId, {
          sessionId: request.session.sessionId,
          unsubscribeTimeline: unsubscribe,
          releaseRuntime,
        });
        if (this.serverCapabilities.has("session-sync-v1")) {
          return { subscribed: true, sync };
        }
        this.emitLegacySync(request.subscriptionId, request.session.sessionId, sync);
        return { subscribed: true };
      }
      case "unsubscribe_session":
        {
          const subscription = this.subscriptions.get(request.subscriptionId);
          if (subscription) this.closeSubscription(subscription);
        }
        this.subscriptions.delete(request.subscriptionId);
        return { subscribed: false };
      case "stop_session":
        await this.registry.stopSession(request.sessionId);
        this.assertAccepting();
        await this.finishCapture(request.sessionId, true);
        this.assertAccepting();
        await this.journal.deleteSession(request.sessionId);
        return { stopped: true };
      case "stop_workspace": {
        const removed = this.journal.sessionIdsForWorkspace(request.workspaceId);
        await this.registry.stopWorkspace(request.workspaceId);
        this.assertAccepting();
        await Promise.all(
          removed.map((sessionId) => this.finishCapture(sessionId, true)),
        );
        this.assertAccepting();
        await this.journal.deleteWorkspace(request.workspaceId);
        return { stopped: true };
      }
      case "stop_connection": {
        const removed = this.journal.sessionIdsForConnection(request.connectionId);
        await this.registry.stopConnection(request.connectionId);
        this.assertAccepting();
        await Promise.all(
          removed.map((sessionId) => this.finishCapture(sessionId, true)),
        );
        this.assertAccepting();
        await this.journal.deleteConnection(request.connectionId);
        return { stopped: true };
      }
      case "stop_all": {
        const removed = this.journal.sessionIds();
        await this.registry.stopAll();
        this.assertAccepting();
        await Promise.all(
          removed.map((sessionId) => this.finishCapture(sessionId, true)),
        );
        this.assertAccepting();
        await this.journal.deleteAllSessions();
        return { stopped: true };
      }
    }
  }

  private async open(
    descriptor: AgentDaemonSessionDescriptor,
  ): Promise<AgentSessionRuntime> {
    return this.serializeSession(descriptor.sessionId, () =>
      this.openRuntime(descriptor),
    );
  }

  private async openRuntime(
    descriptor: AgentDaemonSessionDescriptor,
  ): Promise<AgentSessionRuntime> {
    const runtime = await this.registry.getOrStart(
      sessionDescriptor(descriptor),
    );
    const capture = this.captures.get(descriptor.sessionId);
    const attachedDescriptor =
      capture?.runtime === runtime
        ? {
            ...descriptor,
            providerSessionId: capture.providerSessionId,
            providerSessionPath: capture.providerSessionPath,
          }
        : descriptor;
    await this.assertRuntimeAccepted(descriptor.sessionId);
    await this.journal.recordSession(attachedDescriptor);
    await this.assertRuntimeAccepted(descriptor.sessionId);
    await this.attachTimeline(
      runtime,
      attachedDescriptor.providerSessionId,
      attachedDescriptor.providerSessionPath,
    );
    await this.assertRuntimeAccepted(descriptor.sessionId);
    return runtime;
  }

  private async runCommand(
    request: Extract<AgentDaemonRequest, { type: "session_command" }>,
  ): Promise<unknown> {
    return this.serializeSession(request.session.sessionId, async () => {
      const fingerprint = commandFingerprint(request);
      const begun = await this.journal.beginCommand(
        request.commandId,
        request.session.sessionId,
        fingerprint,
      );
      if (begun.status === "completed") {
        if (begun.result.success) return begun.result.data;
        throw new Error(begun.result.error);
      }
      if (begun.status === "pending") {
        throw unknownCommandOutcome();
      }
      let attemptedProviderAction = false;
      try {
        const runtime = await this.openRuntime(request.session);
        const normalized = runtime.normalizeCommand(request.command);
        attemptedProviderAction = true;
        const data =
          normalized.type === "edit_message" ||
          normalized.type === "fork_message"
            ? {
                fork: await this.awaitProviderAction(
                  this.registry.fork(runtime, normalized),
                ),
              }
            : await this.awaitProviderAction(
                runtime.command(normalized, request.clientMessageId),
              ).then((commandResult) => ({
                ...(normalized.type === "show_usage" ||
                isAgentProviderNotice(commandResult)
                  ? { commandResult }
                  : {}),
                snapshot: {
                  queuedMessages: runtime.snapshot().queuedMessages,
                },
              }));
        if ("fork" in data && data.fork.replacesCurrentSession) {
          const descriptor = {
            ...request.session,
            providerSessionId: data.fork.session.providerSessionId,
            providerSessionPath: data.fork.session.providerSessionPath,
          };
          this.assertStoresAvailable();
          await this.journal.recordSession(descriptor);
          this.assertStoresAvailable();
          await this.attachTimeline(
            runtime,
            descriptor.providerSessionId,
            descriptor.providerSessionPath,
          );
        }
        this.assertStoresAvailable();
        await this.flushCapture(request.session.sessionId);
        this.assertStoresAvailable();
        await this.journal.flush();
        this.assertStoresAvailable();
        await this.journal.completeCommand(
          request.commandId,
          request.session.sessionId,
          fingerprint,
          { success: true, data: data ?? null },
        );
        return data;
      } catch (error) {
        if (this.storesClosing) {
          if (!attemptedProviderAction) throw error;
          throw unknownCommandOutcome(error);
        }
        await this.flushCapture(request.session.sessionId).catch(() => {});
        if (this.storesClosing) {
          if (!attemptedProviderAction) throw error;
          throw unknownCommandOutcome(error);
        }
        await this.journal.flush().catch(() => {});
        if (this.storesClosing) {
          if (!attemptedProviderAction) throw error;
          throw unknownCommandOutcome(error);
        }
        if (!attemptedProviderAction) {
          const result = { success: false, error: errorMessage(error) } as const;
          await this.journal.completeCommand(
            request.commandId,
            request.session.sessionId,
            fingerprint,
            result,
          );
          throw error;
        }
        throw unknownCommandOutcome(error);
      }
    });
  }

  private awaitProviderAction<T>(operation: Promise<T>): Promise<T> {
    const signal = this.shutdownAbort.signal;
    if (signal.aborted) return Promise.reject(new Error("Connector shutdown."));
    return new Promise<T>((resolve, reject) => {
      const aborted = () => {
        cleanup();
        reject(new Error("Connector shutdown interrupted the command."));
      };
      const cleanup = () => signal.removeEventListener("abort", aborted);
      signal.addEventListener("abort", aborted, { once: true });
      void operation.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  private assertAccepting(): void {
    if (!this.accepting) {
      throw new Error("The Host Connector is shutting down.");
    }
  }

  private assertStoresAvailable(): void {
    if (this.storesClosing) {
      throw new Error("The Host Connector stores are shutting down.");
    }
  }

  private async assertRuntimeAccepted(sessionId: string): Promise<void> {
    if (this.accepting) return;
    await this.registry.stopSession(sessionId);
    throw new Error("The Host Connector is shutting down.");
  }

  private async attachTimeline(
    runtime: AgentSessionRuntime,
    providerSessionId: string,
    providerSessionPath: string,
  ): Promise<void> {
    const sessionId = runtime.dbSessionId;
    const existing = this.captures.get(sessionId);
    if (existing?.runtime === runtime) {
      await this.flushCapture(sessionId);
      if (existing.providerSessionId !== providerSessionId) {
        await this.timelines.openSession(
          sessionId,
          providerSessionId,
          runtime.snapshot(),
        );
        existing.providerSessionId = providerSessionId;
        existing.providerSessionPath = providerSessionPath;
      }
      return;
    }
    if (existing) await this.finishCapture(sessionId, false);

    const capture: TimelineCapture = {
      runtime,
      providerSessionId,
      providerSessionPath,
      ready: Promise.resolve(),
      initialized: false,
      buffered: [],
      pending: new Set(),
      unsubscribe: () => {},
    };
    capture.unsubscribe = runtime.observe((envelope) => {
      if (!capture.initialized) {
        capture.buffered.push(envelope);
        return;
      }
      this.commitCapturedEnvelope(sessionId, capture, envelope);
    });
    this.captures.set(sessionId, capture);
    capture.ready = this.timelines
      .openSession(sessionId, providerSessionId, runtime.snapshot())
      .then(() => undefined);
    try {
      await capture.ready;
      this.assertAccepting();
      capture.initialized = true;
      this.publishSessionStatus(sessionId, runtime.snapshot().status);
      for (const envelope of capture.buffered.splice(0)) {
        this.commitCapturedEnvelope(sessionId, capture, envelope);
      }
      await this.flushCapture(sessionId);
      this.assertAccepting();
      for (const subscription of this.subscriptions.values()) {
        if (subscription.sessionId !== sessionId) continue;
        subscription.releaseRuntime();
        subscription.releaseRuntime = runtime.acquireLease();
      }
    } catch (error) {
      capture.unsubscribe();
      if (this.captures.get(sessionId) === capture) {
        this.captures.delete(sessionId);
      }
      throw error;
    }
  }

  private async flushCapture(sessionId: string): Promise<void> {
    const capture = this.captures.get(sessionId);
    if (!capture) return;
    await capture.ready;
    await this.timelines.flush(sessionId);
    await Promise.all(capture.pending);
    if (capture.failure) throw capture.failure;
  }

  private commitCapturedEnvelope(
    sessionId: string,
    capture: TimelineCapture,
    envelope: AgentRuntimeEnvelope,
  ): void {
    let operation: Promise<AgentRuntimeEnvelope | null>;
    try {
      operation = this.timelines.commit(sessionId, envelope).then((committed) => {
        if (committed) {
          this.publishEnvelopeStatus(sessionId, committed);
        }
        return committed;
      });
    } catch (error) {
      this.recordCaptureFailure(sessionId, capture, error);
      return;
    }
    capture.pending.add(operation);
    void operation
      .catch((error) => {
        this.recordCaptureFailure(sessionId, capture, error);
        return null;
      })
      .finally(() => capture.pending.delete(operation));
  }

  private publishEnvelopeStatus(
    sessionId: string,
    envelope: AgentRuntimeEnvelope,
  ): void {
    if (envelope.type === "snapshot") {
      this.publishSessionStatus(sessionId, envelope.data.status);
      return;
    }
    if (
      envelope.data.type === "overtchat_status" &&
      ["idle", "running", "exited"].includes(String(envelope.data.status))
    ) {
      this.publishSessionStatus(
        sessionId,
        envelope.data.status as AgentRuntimeStatus,
      );
    }
  }

  private publishSessionStatus(
    sessionId: string,
    status: AgentRuntimeStatus,
  ): void {
    if (this.publishedSessions.get(sessionId) === status) return;
    this.publishedSessions.set(sessionId, status);
    this.emit({
      type: "session_update",
      session: { sessionId, runtimeStatus: status },
    });
  }

  private publishSessionDirectory(sessionIds: ReadonlySet<string>): void {
    const sessions = [...sessionIds].map((sessionId) => ({
      sessionId,
      runtimeStatus:
        this.captures.get(sessionId)?.runtime.snapshot().status ?? "idle",
    }));
    this.publishedSessions.clear();
    for (const session of sessions) {
      this.publishedSessions.set(session.sessionId, session.runtimeStatus);
    }
    this.emit({ type: "session_directory", sessions });
  }

  private recordCaptureFailure(
    sessionId: string,
    capture: TimelineCapture,
    error: unknown,
  ): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (capture.failure) return;
    capture.failure = failure;
    // A failed fsync means the canonical timeline can no longer advance. Close
    // every affected browser lease immediately instead of leaving a healthy-
    // looking SSE stream parked forever on stale state.
    for (const [subscriptionId, subscription] of this.subscriptions) {
      if (subscription.sessionId !== sessionId) continue;
      this.closeSubscription(subscription);
      this.subscriptions.delete(subscriptionId);
    }
    this.fail(failure);
    console.error(
      `Unable to persist the ${sessionId} session timeline: ${failure.message}`,
    );
  }

  private async finishCapture(
    sessionId: string,
    deleteTimeline: boolean,
  ): Promise<void> {
    const capture = this.captures.get(sessionId);
    let failure: unknown;
    if (capture) {
      // Stop accepting new envelopes before taking the set of pending commits.
      // Otherwise an event can land between flushCapture and unsubscribe.
      capture.unsubscribe();
      try {
        await this.flushCapture(sessionId);
      } catch (error) {
        failure = error;
      }
      if (this.captures.get(sessionId) === capture) {
        this.captures.delete(sessionId);
      }
    }
    if (deleteTimeline) {
      for (const [subscriptionId, subscription] of this.subscriptions) {
        if (subscription.sessionId !== sessionId) continue;
        this.closeSubscription(subscription);
        this.subscriptions.delete(subscriptionId);
      }
    }
    if (deleteTimeline) await this.timelines.deleteSession(sessionId);
    if (failure) throw failure;
  }

  private async retireRuntime(
    sessionId: string,
    runtime: AgentSessionRuntime,
  ): Promise<void> {
    const capture = this.captures.get(sessionId);
    if (!capture || capture.runtime !== runtime) return;
    capture.unsubscribe();
    await this.flushCapture(sessionId);
    if (this.captures.get(sessionId) === capture) {
      this.captures.delete(sessionId);
    }
    await this.timelines.releaseSession(sessionId);
  }

  private closeSubscription(subscription: SessionSubscription): void {
    subscription.unsubscribeTimeline();
    subscription.releaseRuntime();
    if (!this.captures.has(subscription.sessionId)) {
      void this.timelines.releaseSession(subscription.sessionId).catch((error) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.fail(failure);
        console.error(
          `Unable to release the ${subscription.sessionId} session timeline: ${failure.message}`,
        );
      });
    }
  }

  private emitLegacySync(
    subscriptionId: string,
    sessionId: string,
    sync: Awaited<ReturnType<ConnectorTimelineStore["sync"]>>,
  ): void {
    if (sync.reset) {
      if (sync.cursor.sequence === 0) return;
      this.emit({
        type: "session_event",
        subscriptionId,
        sessionId,
        envelope: {
          ...sync.cursor,
          type: "snapshot",
          data: sync.snapshot,
        },
      });
      return;
    }
    for (const envelope of sync.events) {
      this.emit({
        type: "session_event",
        subscriptionId,
        sessionId,
        envelope,
      });
    }
  }

  private serializeSession<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.sessionTails.get(sessionId) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    const tail = result.then(
      () => {},
      () => {},
    );
    this.sessionTails.set(sessionId, tail);
    void tail.finally(() => {
      if (this.sessionTails.get(sessionId) === tail) {
        this.sessionTails.delete(sessionId);
      }
    });
    return result;
  }
}
