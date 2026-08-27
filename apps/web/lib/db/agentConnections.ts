import "server-only";
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentConnections,
  agentHosts,
  agentSessions,
  agentWorkspaces,
  user,
} from "@/lib/db/schema";
import type {
  AgentConnectionListItem,
  AgentDiscoveryTarget,
  AgentProviderSessionMetadata,
  AgentProviderId,
  AgentSessionLaunchConfig,
  AgentSessionListItem,
  AgentTransportId,
} from "@overtchat/agent-bridge";
import type { ConnectorShellMode } from "@overtchat/agent-bridge";
import { resolveInitialAgentSessionTitle } from "@/lib/agents/sessionTitle";

export type AgentHostRow = typeof agentHosts.$inferSelect;
export type AgentConnectionRow = typeof agentConnections.$inferSelect;
export type AgentWorkspaceRow = typeof agentWorkspaces.$inferSelect;
export type AgentSessionRow = typeof agentSessions.$inferSelect;

export type OwnedAgentConnection = {
  host: AgentHostRow;
  connection: AgentConnectionRow;
};

export type OwnedAgentWorkspace = OwnedAgentConnection & {
  workspace: AgentWorkspaceRow;
};

export type OwnedAgentSession = OwnedAgentWorkspace & {
  agentSession: AgentSessionRow;
};

export type NewAgentConnection = {
  userId: string;
  host: {
    name: string;
    transport: AgentTransportId;
    connectorId: string;
    sshAlias?: string | null;
  };
  connection: {
    provider: AgentProviderId;
    executable: string;
    shellMode: ConnectorShellMode;
    detectedVersion: string;
  };
};

export type AgentWorkspaceInstallation = NewAgentConnection & {
  workspace: {
    path: string;
    name: string;
  };
  sessions: ProviderSessionMetadata[];
  ids?: {
    hostId: string;
    connectionId: string;
    workspaceId: string;
    sessionIds?: Record<string, string>;
  };
};

export type ProviderSessionMetadata = AgentProviderSessionMetadata;

function toSessionListItem(row: AgentSessionRow): AgentSessionListItem {
  return {
    id: row.id,
    providerSessionId: row.providerSessionId,
    name: row.name,
    firstMessage: row.firstMessage,
    messageCount: row.messageCount,
    createdAt: row.providerCreatedAt?.getTime() ?? null,
    modifiedAt: row.providerModifiedAt?.getTime() ?? null,
    runtimeStatus: "idle",
  };
}

export async function listAgentConnections(
  userId: string,
): Promise<AgentConnectionListItem[]> {
  const connectionRows = await db
    .select({ host: agentHosts, connection: agentConnections })
    .from(agentConnections)
    .innerJoin(agentHosts, eq(agentConnections.hostId, agentHosts.id))
    .where(eq(agentHosts.userId, userId))
    .orderBy(desc(agentHosts.updatedAt));

  if (connectionRows.length === 0) return [];

  const connectionIds = connectionRows.map(({ connection }) => connection.id);
  const workspaceRows = await db
    .select()
    .from(agentWorkspaces)
    .where(inArray(agentWorkspaces.connectionId, connectionIds))
    .orderBy(agentWorkspaces.name);
  const workspaceIds = workspaceRows.map((workspace) => workspace.id);
  const sessionRows =
    workspaceIds.length === 0
      ? []
      : await db
          .select()
          .from(agentSessions)
          .where(inArray(agentSessions.workspaceId, workspaceIds))
          .orderBy(desc(agentSessions.providerModifiedAt));

  const sessionsByWorkspace = new Map<string, AgentSessionListItem[]>();
  for (const row of sessionRows) {
    const sessions = sessionsByWorkspace.get(row.workspaceId) ?? [];
    sessions.push(toSessionListItem(row));
    sessionsByWorkspace.set(row.workspaceId, sessions);
  }

  const workspacesByConnection = new Map<
    string,
    AgentConnectionListItem["workspaces"]
  >();
  for (const row of workspaceRows) {
    const workspaces = workspacesByConnection.get(row.connectionId) ?? [];
    workspaces.push({
      id: row.id,
      path: row.path,
      name: row.name,
      sessions: sessionsByWorkspace.get(row.id) ?? [],
    });
    workspacesByConnection.set(row.connectionId, workspaces);
  }

  return connectionRows.map(({ host, connection }) => ({
    id: connection.id,
    provider: connection.provider as AgentProviderId,
    executable: connection.executable,
    detectedVersion: connection.detectedVersion,
    lastValidatedAt: connection.lastValidatedAt?.getTime() ?? null,
    host: {
      id: host.id,
      connectorId: host.connectorId,
      name: host.name,
      transport: host.transport,
      sshAlias: host.sshAlias,
    },
    workspaces: workspacesByConnection.get(connection.id) ?? [],
  }));
}

export async function listActiveAgentSessionIds(
  connectorId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .innerJoin(
      agentWorkspaces,
      eq(agentSessions.workspaceId, agentWorkspaces.id),
    )
    .innerJoin(
      agentConnections,
      eq(agentWorkspaces.connectionId, agentConnections.id),
    )
    .innerJoin(agentHosts, eq(agentConnections.hostId, agentHosts.id))
    .innerJoin(user, eq(agentHosts.userId, user.id))
    .where(
      and(
        eq(agentHosts.connectorId, connectorId),
        eq(user.role, "admin"),
        eq(user.banned, false),
      ),
    );
  return rows.map((row) => row.id);
}

export async function getOwnedAgentConnection(
  id: string,
  userId: string,
): Promise<OwnedAgentConnection | null> {
  const [row] = await db
    .select({ host: agentHosts, connection: agentConnections })
    .from(agentConnections)
    .innerJoin(agentHosts, eq(agentConnections.hostId, agentHosts.id))
    .where(and(eq(agentConnections.id, id), eq(agentHosts.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getOwnedAgentWorkspace(
  id: string,
  userId: string,
): Promise<OwnedAgentWorkspace | null> {
  const [row] = await db
    .select({
      host: agentHosts,
      connection: agentConnections,
      workspace: agentWorkspaces,
    })
    .from(agentWorkspaces)
    .innerJoin(
      agentConnections,
      eq(agentWorkspaces.connectionId, agentConnections.id),
    )
    .innerJoin(agentHosts, eq(agentConnections.hostId, agentHosts.id))
    .where(and(eq(agentWorkspaces.id, id), eq(agentHosts.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function findOwnedAgentWorkspaceForTargetProvider(input: {
  userId: string;
  target: AgentDiscoveryTarget;
  provider: AgentProviderId;
  path: string;
}): Promise<OwnedAgentWorkspace | null> {
  const [row] = await db
    .select({
      host: agentHosts,
      connection: agentConnections,
      workspace: agentWorkspaces,
    })
    .from(agentWorkspaces)
    .innerJoin(
      agentConnections,
      eq(agentWorkspaces.connectionId, agentConnections.id),
    )
    .innerJoin(agentHosts, eq(agentConnections.hostId, agentHosts.id))
    .where(
      and(
        eq(agentHosts.userId, input.userId),
        eq(agentHosts.connectorId, input.target.connectorId),
        eq(agentHosts.transport, input.target.transport),
        input.target.transport === "local"
          ? isNull(agentHosts.sshAlias)
          : eq(agentHosts.sshAlias, input.target.sshAlias),
        eq(agentConnections.provider, input.provider),
        eq(agentWorkspaces.path, input.path),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findOwnedAgentConnectionForTargetProvider(input: {
  userId: string;
  target: AgentDiscoveryTarget;
  provider: AgentProviderId;
}): Promise<OwnedAgentConnection | null> {
  const [row] = await db
    .select({ host: agentHosts, connection: agentConnections })
    .from(agentConnections)
    .innerJoin(agentHosts, eq(agentConnections.hostId, agentHosts.id))
    .where(
      and(
        eq(agentHosts.userId, input.userId),
        eq(agentHosts.connectorId, input.target.connectorId),
        eq(agentHosts.transport, input.target.transport),
        input.target.transport === "local"
          ? isNull(agentHosts.sshAlias)
          : eq(agentHosts.sshAlias, input.target.sshAlias),
        eq(agentConnections.provider, input.provider),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getOwnedAgentSession(
  id: string,
  userId: string,
): Promise<OwnedAgentSession | null> {
  const [row] = await db
    .select({
      host: agentHosts,
      connection: agentConnections,
      workspace: agentWorkspaces,
      agentSession: agentSessions,
    })
    .from(agentSessions)
    .innerJoin(
      agentWorkspaces,
      eq(agentSessions.workspaceId, agentWorkspaces.id),
    )
    .innerJoin(
      agentConnections,
      eq(agentWorkspaces.connectionId, agentConnections.id),
    )
    .innerJoin(agentHosts, eq(agentConnections.hostId, agentHosts.id))
    .where(and(eq(agentSessions.id, id), eq(agentHosts.userId, userId)))
    .limit(1);
  return row ?? null;
}

export function createAgentConnection(
  input: NewAgentConnection,
): OwnedAgentConnection {
  return db.transaction((tx) => {
    return upsertAgentConnectionRecord(tx, input);
  });
}

type AgentDbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function agentHostTargetCondition(input: NewAgentConnection) {
  return and(
    eq(agentHosts.userId, input.userId),
    eq(agentHosts.connectorId, input.host.connectorId),
    eq(agentHosts.transport, input.host.transport),
    input.host.transport === "local"
      ? isNull(agentHosts.sshAlias)
      : eq(agentHosts.sshAlias, input.host.sshAlias ?? ""),
  );
}

function upsertAgentConnectionRecord(
  tx: AgentDbTransaction,
  input: NewAgentConnection,
  ids?: { hostId: string; connectionId: string },
): OwnedAgentConnection {
  const existing = tx
    .select({ host: agentHosts, connection: agentConnections })
    .from(agentConnections)
    .innerJoin(agentHosts, eq(agentConnections.hostId, agentHosts.id))
    .where(
      and(
        agentHostTargetCondition(input),
        eq(agentConnections.provider, input.connection.provider),
      ),
    )
    .limit(1)
    .get();
  if (existing) {
    const host =
      existing.host.name === input.host.name
        ? existing.host
        : tx
            .update(agentHosts)
            .set({ name: input.host.name, updatedAt: new Date() })
            .where(eq(agentHosts.id, existing.host.id))
            .returning()
            .get();
    const connection = tx
      .update(agentConnections)
      .set({
        executable: input.connection.executable,
        shellMode: input.connection.shellMode,
        detectedVersion: input.connection.detectedVersion,
        lastValidatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentConnections.id, existing.connection.id))
      .returning()
      .get();
    if (!host || !connection) {
      throw new Error("Failed to update the agent connection backing record.");
    }
    return { host, connection };
  }

  const host = tx
    .insert(agentHosts)
    .values({
      id: ids?.hostId ?? crypto.randomUUID(),
      userId: input.userId,
      ...input.host,
    })
    .returning()
    .get();
  if (!host) throw new Error("Failed to save the agent host.");
  const connection = tx
    .insert(agentConnections)
    .values({
      id: ids?.connectionId ?? crypto.randomUUID(),
      hostId: host.id,
      provider: input.connection.provider,
      executable: input.connection.executable,
      shellMode: input.connection.shellMode,
      detectedVersion: input.connection.detectedVersion,
      lastValidatedAt: new Date(),
    })
    .returning()
    .get();
  if (!connection) throw new Error("Failed to save the agent connection.");
  return { host, connection };
}

export async function touchAgentConnectionValidation(
  id: string,
  userId: string,
  detectedVersion: string,
  shellMode: ConnectorShellMode,
): Promise<boolean> {
  const owned = await getOwnedAgentConnection(id, userId);
  if (!owned) return false;
  return updateAgentConnectionRuntime({
    id,
    userId,
    executable: owned.connection.executable,
    detectedVersion,
    shellMode,
  });
}

export async function updateAgentConnectionRuntime(input: {
  id: string;
  userId: string;
  executable: string;
  detectedVersion: string;
  shellMode: ConnectorShellMode;
}): Promise<boolean> {
  const owned = await getOwnedAgentConnection(input.id, input.userId);
  if (!owned) return false;
  const updated = await db
    .update(agentConnections)
    .set({
      executable: input.executable,
      detectedVersion: input.detectedVersion,
      shellMode: input.shellMode,
      lastValidatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentConnections.id, input.id))
    .returning({ id: agentConnections.id });
  return updated.length > 0;
}

export async function deleteAgentConnection(
  id: string,
  userId: string,
): Promise<boolean> {
  const owned = await getOwnedAgentConnection(id, userId);
  if (!owned) return false;
  const deleted = await db
    .delete(agentHosts)
    .where(
      and(eq(agentHosts.id, owned.host.id), eq(agentHosts.userId, userId)),
    )
    .returning({ id: agentHosts.id });
  return deleted.length > 0;
}

export async function createAgentWorkspace(
  connectionId: string,
  userId: string,
  input: { path: string; name: string },
  workspaceId = crypto.randomUUID(),
): Promise<AgentWorkspaceRow | null> {
  const owned = await getOwnedAgentConnection(connectionId, userId);
  if (!owned) return null;
  const [row] = await db
    .insert(agentWorkspaces)
    .values({
      id: workspaceId,
      connectionId,
      path: input.path,
      name: input.name,
    })
    .returning();
  return row ?? null;
}

export function saveAgentWorkspaceInstallation(
  input: AgentWorkspaceInstallation,
): OwnedAgentConnection & {
  workspace: AgentWorkspaceRow;
  sessions: AgentSessionRow[];
} {
  return db.transaction((tx) => {
    const owned = upsertAgentConnectionRecord(tx, input, input.ids);
    const existingWorkspace = tx
      .select()
      .from(agentWorkspaces)
      .where(
        and(
          eq(agentWorkspaces.connectionId, owned.connection.id),
          eq(agentWorkspaces.path, input.workspace.path),
        ),
      )
      .limit(1)
      .get();
    const workspace = existingWorkspace
      ? tx
          .update(agentWorkspaces)
          .set({ name: input.workspace.name, updatedAt: new Date() })
          .where(eq(agentWorkspaces.id, existingWorkspace.id))
          .returning()
          .get()
      : tx
          .insert(agentWorkspaces)
          .values({
            id: input.ids?.workspaceId ?? crypto.randomUUID(),
            connectionId: owned.connection.id,
            path: input.workspace.path,
            name: input.workspace.name,
          })
          .returning()
          .get();
    if (!workspace) throw new Error("Failed to save the agent workspace.");
    return {
      ...owned,
      workspace,
      sessions: syncAgentWorkspaceSessionsInTransaction(
        tx,
        workspace.id,
        input.sessions,
        input.ids?.sessionIds,
      ),
    };
  });
}

export async function deleteAgentWorkspace(
  id: string,
  userId: string,
): Promise<boolean> {
  const owned = await getOwnedAgentWorkspace(id, userId);
  if (!owned) return false;
  const deleted = await db
    .delete(agentWorkspaces)
    .where(eq(agentWorkspaces.id, id))
    .returning({ id: agentWorkspaces.id });
  return deleted.length > 0;
}

export function syncAgentWorkspaceSessions(
  workspaceId: string,
  sessions: ProviderSessionMetadata[],
): AgentSessionRow[] {
  return db.transaction((tx) =>
    syncAgentWorkspaceSessionsInTransaction(tx, workspaceId, sessions),
  );
}

function syncAgentWorkspaceSessionsInTransaction(
  tx: AgentDbTransaction,
  workspaceId: string,
  sessions: ProviderSessionMetadata[],
  sessionIds: Record<string, string> = {},
): AgentSessionRow[] {
  const now = new Date();
  const paths = sessions.map((session) => session.providerSessionPath);
  if (paths.length === 0) {
    tx.delete(agentSessions)
      .where(eq(agentSessions.workspaceId, workspaceId))
      .run();
    return [];
  }

  for (const session of sessions) {
    const initialTitle = resolveInitialAgentSessionTitle(session);
    tx.insert(agentSessions)
      .values({
        id: sessionIds[session.providerSessionPath] ?? crypto.randomUUID(),
        workspaceId,
        providerSessionId: session.providerSessionId,
        providerSessionPath: session.providerSessionPath,
        name: initialTitle,
        firstMessage: session.firstMessage,
        messageCount: session.messageCount,
        providerCreatedAt: session.createdAt,
        providerModifiedAt: session.modifiedAt,
        model: session.launchConfig?.model,
        thinkingOptionId: session.launchConfig?.thinkingOptionId,
        modeId: session.launchConfig?.modeId,
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          agentSessions.workspaceId,
          agentSessions.providerSessionPath,
        ],
        set: {
          providerSessionId: session.providerSessionId,
          ...(initialTitle
            ? {
                name: sql`coalesce(nullif(trim(${agentSessions.name}), ''), ${initialTitle})`,
              }
            : {}),
          firstMessage: session.firstMessage,
          messageCount: session.messageCount,
          providerCreatedAt: session.createdAt,
          providerModifiedAt: session.modifiedAt,
          ...(session.launchConfig?.model
            ? { model: session.launchConfig.model }
            : {}),
          ...(session.launchConfig?.thinkingOptionId
            ? { thinkingOptionId: session.launchConfig.thinkingOptionId }
            : {}),
          ...(session.launchConfig?.modeId
            ? { modeId: session.launchConfig.modeId }
            : {}),
          lastSyncedAt: now,
          updatedAt: now,
        },
      })
      .run();
  }

  tx.delete(agentSessions)
    .where(
      and(
        eq(agentSessions.workspaceId, workspaceId),
        notInArray(agentSessions.providerSessionPath, paths),
      ),
    )
    .run();

  return tx
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.workspaceId, workspaceId))
    .orderBy(desc(agentSessions.providerModifiedAt))
    .all();
}

export async function upsertAgentSession(
  workspaceId: string,
  session: ProviderSessionMetadata,
  sessionId = crypto.randomUUID(),
  launchConfig: AgentSessionLaunchConfig = {},
): Promise<AgentSessionRow> {
  const now = new Date();
  const initialTitle = resolveInitialAgentSessionTitle(session);
  const [row] = await db
    .insert(agentSessions)
    .values({
      id: sessionId,
      workspaceId,
      providerSessionId: session.providerSessionId,
      providerSessionPath: session.providerSessionPath,
      model: launchConfig.model,
      thinkingOptionId: launchConfig.thinkingOptionId,
      modeId: launchConfig.modeId,
      name: initialTitle,
      firstMessage: session.firstMessage,
      messageCount: session.messageCount,
      providerCreatedAt: session.createdAt,
      providerModifiedAt: session.modifiedAt,
      lastSyncedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        agentSessions.workspaceId,
        agentSessions.providerSessionPath,
      ],
      set: {
        providerSessionId: session.providerSessionId,
        model: launchConfig.model,
        thinkingOptionId: launchConfig.thinkingOptionId,
        modeId: launchConfig.modeId,
        ...(initialTitle
          ? {
              name: sql`coalesce(nullif(trim(${agentSessions.name}), ''), ${initialTitle})`,
            }
          : {}),
        firstMessage: session.firstMessage,
        messageCount: session.messageCount,
        providerCreatedAt: session.createdAt,
        providerModifiedAt: session.modifiedAt,
        lastSyncedAt: now,
        updatedAt: now,
      },
    })
    .returning();
  if (!row) throw new Error("Failed to save agent session metadata.");
  return row;
}

export async function replaceAgentSessionProviderSession(
  id: string,
  session: ProviderSessionMetadata,
  launchConfig?: AgentSessionLaunchConfig,
): Promise<void> {
  const now = new Date();
  await db
    .update(agentSessions)
    .set({
      providerSessionId: session.providerSessionId,
      providerSessionPath: session.providerSessionPath,
      ...(launchConfig
        ? {
            model: launchConfig.model ?? null,
            thinkingOptionId: launchConfig.thinkingOptionId ?? null,
            modeId: launchConfig.modeId ?? null,
          }
        : {}),
      firstMessage: session.firstMessage,
      messageCount: session.messageCount,
      providerCreatedAt: session.createdAt,
      providerModifiedAt: session.modifiedAt,
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(agentSessions.id, id));
}

export async function updateAgentSessionMetadata(
  id: string,
  patch: {
    name?: string | null;
    firstMessage?: string | null;
    messageCount?: number;
    providerModifiedAt?: Date;
    launchConfig?: AgentSessionLaunchConfig;
  },
): Promise<void> {
  const { launchConfig, name: providerName, ...metadata } = patch;
  const initialTitle = resolveInitialAgentSessionTitle({
    name: providerName,
    firstMessage: patch.firstMessage,
  });
  await db
    .update(agentSessions)
    .set({
      ...metadata,
      ...(initialTitle
        ? {
            name: sql`coalesce(nullif(trim(${agentSessions.name}), ''), ${initialTitle})`,
          }
        : {}),
      ...(launchConfig
        ? {
            model: launchConfig.model ?? null,
            thinkingOptionId: launchConfig.thinkingOptionId ?? null,
            modeId: launchConfig.modeId ?? null,
          }
        : {}),
      updatedAt: new Date(),
      lastSyncedAt: new Date(),
    })
    .where(eq(agentSessions.id, id));
}

export async function renameAgentSession(
  id: string,
  name: string,
): Promise<void> {
  await db
    .update(agentSessions)
    .set({
      name: name.trim(),
      updatedAt: new Date(),
      lastSyncedAt: new Date(),
    })
    .where(eq(agentSessions.id, id));
}
