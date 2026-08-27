import "server-only";
import {
  agentProviderSnapshotSchema,
  agentSessionLaunchConfigSchema,
  type AgentDaemonWorkspaceDescriptor,
  type AgentDiscoveryTarget,
  type AgentProviderId,
  type AgentProviderSnapshot,
  type AgentProviderSnapshotEntry,
  type AgentSessionLaunchConfig,
  type DetectedAgentInstallation,
} from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "./broker";
import {
  daemonTarget,
  parseProviderSessionMetadata,
} from "./descriptors";
import {
  findOwnedAgentConnectionForTargetProvider,
  findOwnedAgentWorkspaceForTargetProvider,
  getOwnedAgentWorkspace,
  listAgentConnections,
  saveAgentWorkspaceInstallation,
  syncAgentWorkspaceSessions,
  upsertAgentSession,
  updateAgentConnectionRuntime,
  type OwnedAgentWorkspace,
} from "@/lib/db/agentConnections";
import {
  agentConnectionTarget,
  agentTargetKey,
  groupAgentWorkspaces,
} from "@/lib/agents/workspaces";

const workspaceProviderLocks = new Map<string, Promise<void>>();

type ReadyProvider = Extract<
  AgentProviderSnapshotEntry,
  { status: "ready" }
>;

export type AgentWorkspaceSyncResult = {
  providers: number;
  created: number;
  refreshed: number;
  failures: Array<{ provider: string; message: string }>;
};

function targetFromOwnedWorkspace(
  owned: OwnedAgentWorkspace,
): AgentDiscoveryTarget {
  return owned.host.transport === "local"
    ? {
        connectorId: owned.host.connectorId,
        transport: "local",
      }
    : {
        connectorId: owned.host.connectorId,
        transport: "ssh",
        sshAlias: owned.host.sshAlias!,
      };
}

function readyProviders(snapshot: AgentProviderSnapshot): ReadyProvider[] {
  return snapshot.providers.filter(
    (entry): entry is ReadyProvider => entry.status === "ready",
  );
}

export async function getAgentProviderSnapshot(
  target: AgentDiscoveryTarget,
  options: { refresh?: boolean } = {},
): Promise<AgentProviderSnapshot> {
  return agentProviderSnapshotSchema.parse(
    await hostConnectorBroker.request(target.connectorId, {
      type: "provider_snapshot",
      target,
      refresh: options.refresh,
    }),
  );
}

export async function resolveAgentWorkspaceProvider(input: {
  userId: string;
  anchorWorkspaceId: string;
  provider: AgentProviderId;
  refresh?: boolean;
}): Promise<{
  anchor: OwnedAgentWorkspace;
  backing: OwnedAgentWorkspace | null;
  target: AgentDiscoveryTarget;
  installation: ReadyProvider;
  descriptor: AgentDaemonWorkspaceDescriptor;
}> {
  const anchor = await getOwnedAgentWorkspace(
    input.anchorWorkspaceId,
    input.userId,
  );
  if (!anchor) throw new Error("Agent workspace not found.");
  const target = targetFromOwnedWorkspace(anchor);
  const snapshot = await getAgentProviderSnapshot(target, {
    refresh: input.refresh,
  });
  const backing = await findOwnedAgentWorkspaceForTargetProvider({
    userId: input.userId,
    target,
    provider: input.provider,
    path: anchor.workspace.path,
  });
  const configured =
    backing ??
    (await findOwnedAgentConnectionForTargetProvider({
      userId: input.userId,
      target,
      provider: input.provider,
    }));
  const installation =
    readyProviders(snapshot).find(
      (entry) => entry.provider === input.provider,
    ) ??
    (configured
      ? {
          provider: input.provider,
          status: "ready" as const,
          executable: configured.connection.executable,
          version: configured.connection.detectedVersion ?? "configured",
          shellMode: configured.connection.shellMode,
        }
      : undefined);
  if (!installation) {
    throw new Error("This coding agent is not available on the selected machine.");
  }
  return {
    anchor,
    backing,
    target,
    installation,
    descriptor: {
      connectionId: configured?.connection.id ?? crypto.randomUUID(),
      workspaceId: backing?.workspace.id ?? crypto.randomUUID(),
      provider: input.provider,
      target: daemonTarget(anchor.host, installation.shellMode),
      executable: installation.executable,
      cwd: anchor.workspace.path,
      detectedVersion: installation.version,
    },
  };
}

async function withWorkspaceProviderLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  while (workspaceProviderLocks.has(key)) {
    await workspaceProviderLocks.get(key);
  }
  let release = () => {};
  const active = new Promise<void>((resolve) => {
    release = resolve;
  });
  workspaceProviderLocks.set(key, active);
  try {
    return await operation();
  } finally {
    release();
    if (workspaceProviderLocks.get(key) === active) {
      workspaceProviderLocks.delete(key);
    }
  }
}

export async function createAgentWorkspaceProviderSession(input: {
  userId: string;
  anchorWorkspaceId: string;
  provider: AgentProviderId;
  launchConfig: AgentSessionLaunchConfig;
}): Promise<{
  session: { id: string };
  launchConfig: AgentSessionLaunchConfig;
  snapshot: unknown;
}> {
  const anchor = await getOwnedAgentWorkspace(
    input.anchorWorkspaceId,
    input.userId,
  );
  if (!anchor) throw new Error("Agent workspace not found.");
  const target = targetFromOwnedWorkspace(anchor);
  const key = JSON.stringify([
    input.userId,
    agentTargetKey(target),
    anchor.workspace.path,
    input.provider,
  ]);
  return withWorkspaceProviderLock(key, async () => {
    const resolved = await resolveAgentWorkspaceProvider(input);
    const sessionId = crypto.randomUUID();
    const created = await hostConnectorBroker.request<{
      session: unknown;
      launchConfig: unknown;
      snapshot: unknown;
    }>(resolved.target.connectorId, {
      type: "create_session",
      sessionId,
      workspace: resolved.descriptor,
      launchConfig: input.launchConfig,
    });
    const launchConfig = agentSessionLaunchConfigSchema.parse(
      created.launchConfig,
    );
    const metadata = parseProviderSessionMetadata(created.session);
    try {
      if (resolved.backing) {
        await updateAgentConnectionRuntime({
          id: resolved.backing.connection.id,
          userId: input.userId,
          executable: resolved.installation.executable,
          detectedVersion: resolved.installation.version,
          shellMode: resolved.installation.shellMode,
        });
        await upsertAgentSession(
          resolved.backing.workspace.id,
          metadata,
          sessionId,
          launchConfig,
        );
      } else {
        saveAgentWorkspaceInstallation({
          userId: input.userId,
          host:
            resolved.target.transport === "local"
              ? {
                  name: "This server",
                  transport: "local",
                  connectorId: resolved.target.connectorId,
                }
              : {
                  name: resolved.target.sshAlias,
                  transport: "ssh",
                  connectorId: resolved.target.connectorId,
                  sshAlias: resolved.target.sshAlias,
                },
          connection: {
            provider: input.provider,
            executable: resolved.installation.executable,
            shellMode: resolved.installation.shellMode,
            detectedVersion: resolved.installation.version,
          },
          workspace: {
            path: resolved.anchor.workspace.path,
            name: resolved.anchor.workspace.name,
          },
          sessions: [{ ...metadata, launchConfig }],
          ids: {
            hostId: crypto.randomUUID(),
            connectionId: resolved.descriptor.connectionId,
            workspaceId: resolved.descriptor.workspaceId,
            sessionIds: {
              [metadata.providerSessionPath]: sessionId,
            },
          },
        });
      }
    } catch (error) {
      await hostConnectorBroker
        .request(resolved.target.connectorId, {
          type: "stop_session",
          sessionId,
        })
        .catch(() => {});
      throw error;
    }
    return {
      session: { id: sessionId },
      launchConfig,
      snapshot: created.snapshot,
    };
  });
}

async function syncWorkspaceProvider(input: {
  userId: string;
  target: AgentDiscoveryTarget;
  path: string;
  name: string;
  installation: ReadyProvider;
  materializeEmpty: boolean;
}): Promise<"created" | "refreshed" | "skipped"> {
  const backing = await findOwnedAgentWorkspaceForTargetProvider({
    userId: input.userId,
    target: input.target,
    provider: input.installation.provider,
    path: input.path,
  });
  const configured =
    backing ??
    (await findOwnedAgentConnectionForTargetProvider({
      userId: input.userId,
      target: input.target,
      provider: input.installation.provider,
    }));
  const descriptor: AgentDaemonWorkspaceDescriptor = {
    connectionId: configured?.connection.id ?? crypto.randomUUID(),
    workspaceId: backing?.workspace.id ?? crypto.randomUUID(),
    provider: input.installation.provider,
    target:
      input.target.transport === "local"
        ? { transport: "local", shellMode: input.installation.shellMode }
        : {
            transport: "ssh",
            alias: input.target.sshAlias,
            shellMode: input.installation.shellMode,
          },
    executable: input.installation.executable,
    cwd: input.path,
    detectedVersion: input.installation.version,
  };
  const sessions = (
    await hostConnectorBroker.request<unknown[]>(input.target.connectorId, {
      type: "list_sessions",
      workspace: descriptor,
    })
  ).map(parseProviderSessionMetadata);

  if (backing) {
    await updateAgentConnectionRuntime({
      id: backing.connection.id,
      userId: input.userId,
      executable: input.installation.executable,
      detectedVersion: input.installation.version,
      shellMode: input.installation.shellMode,
    });
    syncAgentWorkspaceSessions(backing.workspace.id, sessions);
    return "refreshed";
  }
  if (!input.materializeEmpty && sessions.length === 0) return "skipped";

  saveAgentWorkspaceInstallation({
    userId: input.userId,
    host:
      input.target.transport === "local"
        ? {
            name: "This server",
            transport: "local",
            connectorId: input.target.connectorId,
          }
        : {
            name: input.target.sshAlias,
            transport: "ssh",
            connectorId: input.target.connectorId,
            sshAlias: input.target.sshAlias,
          },
    connection: {
      provider: input.installation.provider,
      executable: input.installation.executable,
      shellMode: input.installation.shellMode,
      detectedVersion: input.installation.version,
    },
    workspace: { path: input.path, name: input.name },
    sessions,
    ids: {
      hostId: crypto.randomUUID(),
      connectionId: descriptor.connectionId,
      workspaceId: descriptor.workspaceId,
    },
  });
  return "created";
}

export async function provisionAgentWorkspace(input: {
  userId: string;
  target: AgentDiscoveryTarget;
  path: string;
  installations?: DetectedAgentInstallation[];
}): Promise<AgentWorkspaceSyncResult> {
  const snapshot = await getAgentProviderSnapshot(input.target);
  const providersById = new Map(
    readyProviders(snapshot).map((installation) => [
      installation.provider,
      installation,
    ]),
  );
  for (const installation of input.installations ?? []) {
    providersById.set(installation.provider, {
      ...installation,
      status: "ready",
    });
  }
  const providers = [...providersById.values()];
  if (providers.length === 0) {
    throw new Error("No supported coding agents were detected on this machine.");
  }
  const workspace = await hostConnectorBroker.request<{
    path: string;
    name: string;
  }>(input.target.connectorId, {
    type: "probe_workspace",
    target:
      input.target.transport === "local"
        ? { transport: "local", shellMode: providers[0]!.shellMode }
        : {
            transport: "ssh",
            alias: input.target.sshAlias,
            shellMode: providers[0]!.shellMode,
          },
    path: input.path,
  });
  const result: AgentWorkspaceSyncResult = {
    providers: providers.length,
    created: 0,
    refreshed: 0,
    failures: [],
  };
  for (const installation of providers) {
    try {
      const outcome = await syncWorkspaceProvider({
        userId: input.userId,
        target: input.target,
        path: workspace.path,
        name: workspace.name,
        installation,
        materializeEmpty: true,
      });
      if (outcome === "created") result.created += 1;
      else if (outcome === "refreshed") result.refreshed += 1;
    } catch (error) {
      result.failures.push({
        provider: installation.provider,
        message: error instanceof Error ? error.message : "Agent setup failed.",
      });
    }
  }
  return result;
}

export async function refreshAgentWorkspaces(
  userId: string,
): Promise<AgentWorkspaceSyncResult> {
  const connections = await listAgentConnections(userId);
  const groups = groupAgentWorkspaces(connections);
  const snapshots = new Map<string, Promise<AgentProviderSnapshot>>();
  const result: AgentWorkspaceSyncResult = {
    providers: 0,
    created: 0,
    refreshed: 0,
    failures: [],
  };

  for (const group of groups) {
    const target = agentConnectionTarget(group.targets[0]!.connection);
    const key = agentTargetKey(target);
    let snapshot = snapshots.get(key);
    if (!snapshot) {
      snapshot = getAgentProviderSnapshot(target, { refresh: true });
      snapshots.set(key, snapshot);
    }
    let providers: ReadyProvider[];
    try {
      providers = readyProviders(await snapshot);
    } catch (error) {
      result.failures.push({
        provider: "discovery",
        message: error instanceof Error ? error.message : "Agent refresh failed.",
      });
      continue;
    }
    result.providers += providers.length;
    for (const installation of providers) {
      try {
        const outcome = await syncWorkspaceProvider({
          userId,
          target,
          path: group.path,
          name: group.name,
          installation,
          materializeEmpty: false,
        });
        if (outcome === "created") result.created += 1;
        else if (outcome === "refreshed") result.refreshed += 1;
      } catch (error) {
        result.failures.push({
          provider: installation.provider,
          message: error instanceof Error ? error.message : "Refresh failed.",
        });
      }
    }
  }
  return result;
}
