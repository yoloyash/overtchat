import type {
  AgentDaemonRequest,
  AgentDaemonSessionDescriptor,
  AgentDaemonTarget,
  AgentDaemonWorkspaceDescriptor,
  AgentPromptImage,
  HostConnectorCommand,
  HostConnectorEventPayload,
} from "@overtchat/agent-bridge";
import {
  AgentRuntimeRegistry,
  agentProviderAdapter,
  configureProcessSpawner,
  discoverAgentInstallations,
  inspectAgentWorkspaceGitStatus,
  listAgentDirectories,
  probeAgentWorkspace,
  targetForDiscovery,
  type AgentSessionRuntime,
  type HostTarget,
  type ResolvedAgentImage,
} from "@overtchat/agent-runtime";
import { listSshHosts } from "./ssh.js";
import { ConnectorProcessHost } from "./runtime.js";
import { ConnectorStateJournal } from "./state.js";

type Emit = (event: HostConnectorEventPayload) => void;
type ResolveImages = (
  images: readonly AgentPromptImage[],
) => Promise<ResolvedAgentImage[]>;

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
  private readonly registry: AgentRuntimeRegistry;
  private readonly subscriptions = new Map<string, () => void>();
  private readonly sessionTails = new Map<string, Promise<void>>();
  private connectionEpoch: string | null = null;

  constructor(
    private readonly emit: Emit,
    resolveImages: ResolveImages,
    private readonly journal: ConnectorStateJournal,
  ) {
    configureProcessSpawner(this.processHost.spawn);
    this.registry = new AgentRuntimeRegistry({
      resolveImages,
      updateSessionMetadata: (sessionId, patch) => {
        const { providerModifiedAt, ...metadata } = patch;
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
    });
  }

  async handle(command: HostConnectorCommand): Promise<void> {
    if (command.type === "sync") {
      await this.beginConnection(
        command.connectionEpoch,
        command.activeSessionIds,
      );
      return;
    }
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
    }
  }

  async stop(): Promise<void> {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
    await this.registry.stopAll();
    this.processHost.stop();
  }

  private async beginConnection(
    connectionEpoch: string,
    activeSessionIds: string[],
  ): Promise<void> {
    if (this.connectionEpoch !== connectionEpoch) {
      this.connectionEpoch = connectionEpoch;
      for (const unsubscribe of this.subscriptions.values()) unsubscribe();
      this.subscriptions.clear();
    }
    const active = new Set(activeSessionIds);
    await Promise.all(
      this.journal
        .sessionIds()
        .filter((sessionId) => !active.has(sessionId))
        .map((sessionId) => this.registry.stopSession(sessionId)),
    );
    await this.journal.retainSessions(active);
  }

  private async handleRequest(request: AgentDaemonRequest): Promise<unknown> {
    switch (request.type) {
      case "list_ssh_hosts":
        return listSshHosts();
      case "discover":
        return discoverAgentInstallations(targetForDiscovery(request.target));
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
      case "list_directories":
        return listAgentDirectories(hostTarget(request.target), request.path);
      case "probe_workspace":
        return probeAgentWorkspace(hostTarget(request.target), request.path);
      case "git_status":
        return inspectAgentWorkspaceGitStatus(
          hostTarget(request.target),
          request.path,
        );
      case "create_session": {
        const created = await this.serializeSession(request.sessionId, () =>
          this.registry.create(
            request.sessionId,
            workspaceDescriptor(request.workspace),
          ),
        );
        await this.journal.recordSession({
          ...request.workspace,
          sessionId: request.sessionId,
          providerSessionId: created.session.providerSessionId,
          providerSessionPath: created.session.providerSessionPath,
        });
        return {
          session: created.session,
          snapshot: created.runtime.snapshot(),
        };
      }
      case "open_session": {
        const runtime = await this.open(request.session);
        return { snapshot: runtime.snapshot() };
      }
      case "session_command":
        return this.runCommand(request);
      case "subscribe_session": {
        this.subscriptions.get(request.subscriptionId)?.();
        const runtime = await this.open(request.session);
        const unsubscribe = runtime.subscribe((envelope) => {
          this.emit({
            type: "session_event",
            subscriptionId: request.subscriptionId,
            sessionId: request.session.sessionId,
            envelope,
          });
        }, request.after);
        this.subscriptions.set(request.subscriptionId, unsubscribe);
        return { subscribed: true };
      }
      case "unsubscribe_session":
        this.subscriptions.get(request.subscriptionId)?.();
        this.subscriptions.delete(request.subscriptionId);
        return { subscribed: false };
      case "stop_session":
        await this.registry.stopSession(request.sessionId);
        await this.journal.deleteSession(request.sessionId);
        return { stopped: true };
      case "stop_workspace":
        await this.registry.stopWorkspace(request.workspaceId);
        await this.journal.deleteWorkspace(request.workspaceId);
        return { stopped: true };
      case "stop_connection":
        await this.registry.stopConnection(request.connectionId);
        await this.journal.deleteConnection(request.connectionId);
        return { stopped: true };
      case "stop_all":
        await this.registry.stopAll();
        await this.journal.deleteAllSessions();
        return { stopped: true };
    }
  }

  private async open(
    descriptor: AgentDaemonSessionDescriptor,
  ): Promise<AgentSessionRuntime> {
    return this.serializeSession(descriptor.sessionId, async () => {
      const runtime = await this.registry.getOrStart(
        sessionDescriptor(descriptor),
      );
      await this.journal.recordSession(descriptor);
      return runtime;
    });
  }

  private async runCommand(
    request: Extract<AgentDaemonRequest, { type: "session_command" }>,
  ): Promise<unknown> {
    const cached = this.journal.commandResult(request.commandId);
    if (cached) {
      if (cached.success) return cached.data;
      throw new Error(cached.error);
    }
    return this.serializeSession(request.session.sessionId, async () => {
      const insideCached = this.journal.commandResult(request.commandId);
      if (insideCached) {
        if (insideCached.success) return insideCached.data;
        throw new Error(insideCached.error);
      }
      try {
        await this.journal.recordSession(request.session);
        const runtime = await this.registry.getOrStart(
          sessionDescriptor(request.session),
        );
        const normalized = runtime.normalizeCommand(request.command);
        const data =
          normalized.type === "edit_message" ||
          normalized.type === "fork_message"
            ? {
                fork: await this.registry.fork(runtime, normalized),
              }
            : {
                commandResult: await runtime.command(
                  normalized,
                  request.clientMessageId,
                ),
                snapshot: {
                  queuedMessages: runtime.snapshot().queuedMessages,
                },
              };
        await this.journal.recordCommandResult(request.commandId, {
          success: true,
          data: data ?? null,
        });
        return data;
      } catch (error) {
        const result = { success: false, error: errorMessage(error) } as const;
        await this.journal.recordCommandResult(request.commandId, result);
        throw error;
      }
    });
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
