import "server-only";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentConnections,
  agentHosts,
  agentSessions,
  agentWorkspaces,
} from "@/lib/db/schema";
import type {
  AgentConnectionListItem,
  AgentProviderId,
  AgentSessionListItem,
  AgentTransportId,
} from "@/lib/agents/types";
import type { ConnectorShellMode } from "@overtchat/agent-bridge";

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

export type ProviderSessionMetadata = {
  providerSessionId: string;
  providerSessionPath: string;
  name: string | null;
  firstMessage: string | null;
  messageCount: number;
  createdAt: Date | null;
  modifiedAt: Date | null;
};

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
    const hostId = crypto.randomUUID();
    const [host] = tx
      .insert(agentHosts)
      .values({
        id: hostId,
        userId: input.userId,
        ...input.host,
      })
      .returning()
      .all();
    const [connection] = tx
      .insert(agentConnections)
      .values({
        id: crypto.randomUUID(),
        hostId,
        provider: input.connection.provider,
        executable: input.connection.executable,
        shellMode: input.connection.shellMode,
        detectedVersion: input.connection.detectedVersion,
        lastValidatedAt: new Date(),
      })
      .returning()
      .all();
    if (!host || !connection) {
      throw new Error("Failed to create agent connection.");
    }
    return { host, connection };
  });
}

export async function touchAgentConnectionValidation(
  id: string,
  userId: string,
  detectedVersion: string,
  shellMode: ConnectorShellMode,
): Promise<boolean> {
  const owned = await getOwnedAgentConnection(id, userId);
  if (!owned) return false;
  const updated = await db
    .update(agentConnections)
    .set({
      detectedVersion,
      shellMode,
      lastValidatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentConnections.id, id))
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
): Promise<AgentWorkspaceRow | null> {
  const owned = await getOwnedAgentConnection(connectionId, userId);
  if (!owned) return null;
  const [row] = await db
    .insert(agentWorkspaces)
    .values({
      id: crypto.randomUUID(),
      connectionId,
      path: input.path,
      name: input.name,
    })
    .returning();
  return row ?? null;
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
  return db.transaction((tx) => {
    const now = new Date();
    const paths = sessions.map((session) => session.providerSessionPath);
    if (paths.length === 0) {
      tx.delete(agentSessions)
        .where(eq(agentSessions.workspaceId, workspaceId))
        .run();
      return [];
    }

    for (const session of sessions) {
      tx.insert(agentSessions)
        .values({
          id: crypto.randomUUID(),
          workspaceId,
          providerSessionId: session.providerSessionId,
          providerSessionPath: session.providerSessionPath,
          name: session.name,
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
            name: session.name,
            firstMessage: session.firstMessage,
            messageCount: session.messageCount,
            providerCreatedAt: session.createdAt,
            providerModifiedAt: session.modifiedAt,
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
  });
}

export async function upsertAgentSession(
  workspaceId: string,
  session: ProviderSessionMetadata,
): Promise<AgentSessionRow> {
  const now = new Date();
  const [row] = await db
    .insert(agentSessions)
    .values({
      id: crypto.randomUUID(),
      workspaceId,
      providerSessionId: session.providerSessionId,
      providerSessionPath: session.providerSessionPath,
      name: session.name,
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
        name: session.name,
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

export async function updateAgentSessionMetadata(
  id: string,
  patch: {
    name?: string | null;
    firstMessage?: string | null;
    messageCount?: number;
    providerModifiedAt?: Date;
  },
): Promise<void> {
  await db
    .update(agentSessions)
    .set({
      ...patch,
      updatedAt: new Date(),
      lastSyncedAt: new Date(),
    })
    .where(eq(agentSessions.id, id));
}
