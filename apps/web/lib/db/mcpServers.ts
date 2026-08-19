import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mcpServers, userMcpServerPreferences } from "@/lib/db/schema";
import type {
  AvailableMcpServer,
  McpServer,
  McpServerInput,
} from "@/lib/mcp/schema";
import {
  invalidateMcpServer,
  invalidateUserMcpServer,
} from "@/lib/mcp/manager";

export type McpServerRow = typeof mcpServers.$inferSelect;

export function toMcpServer(row: McpServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    availability: row.availability,
    config: row.config,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMcpServers(): Promise<McpServerRow[]> {
  return db.select().from(mcpServers).orderBy(asc(mcpServers.name));
}

function availableToRole(role: string | null | undefined) {
  return role === "admin"
    ? inArray(mcpServers.availability, ["everyone", "admins"])
    : eq(mcpServers.availability, "everyone");
}

async function listAuthorizedMcpServers(
  userId: string,
  role: string | null | undefined,
) {
  return db
    .select({
      server: mcpServers,
      preferenceEnabled: userMcpServerPreferences.enabled,
    })
    .from(mcpServers)
    .leftJoin(
      userMcpServerPreferences,
      and(
        eq(userMcpServerPreferences.serverId, mcpServers.id),
        eq(userMcpServerPreferences.userId, userId),
      ),
    )
    .where(availableToRole(role))
    .orderBy(asc(mcpServers.name));
}

export async function listAvailableMcpServers(
  userId: string,
  role: string | null | undefined,
): Promise<AvailableMcpServer[]> {
  const rows = await listAuthorizedMcpServers(userId, role);
  return rows.map(({ server, preferenceEnabled }) => ({
    id: server.id,
    name: server.name,
    enabled: preferenceEnabled ?? true,
  }));
}

export async function listEffectiveMcpServers(
  userId: string,
  role: string | null | undefined,
): Promise<McpServerRow[]> {
  const rows = await listAuthorizedMcpServers(userId, role);
  return rows
    .filter(({ preferenceEnabled }) => preferenceEnabled !== false)
    .map(({ server }) => server);
}

export async function getMcpServer(id: string): Promise<McpServerRow | null> {
  const [row] = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, id))
    .limit(1);
  return row ?? null;
}

export async function createMcpServer(
  input: McpServerInput,
): Promise<McpServerRow> {
  const [row] = await db
    .insert(mcpServers)
    .values({ id: crypto.randomUUID(), ...input })
    .returning();
  return row;
}

export async function updateMcpServer(
  id: string,
  input: McpServerInput,
): Promise<McpServerRow | null> {
  const previous = await getMcpServer(id);
  const [row] = await db
    .update(mcpServers)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(mcpServers.id, id))
    .returning();
  if (row) {
    const disconnect =
      !previous ||
      previous.availability !== row.availability ||
      JSON.stringify(previous.config) !== JSON.stringify(row.config);
    await invalidateMcpServer(id, { disconnect });
  }
  return row ?? null;
}

export async function setMcpServerPreference(
  userId: string,
  role: string | null | undefined,
  serverId: string,
  enabled: boolean,
): Promise<AvailableMcpServer | null> {
  const [server] = await db
    .select({ id: mcpServers.id, name: mcpServers.name })
    .from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), availableToRole(role)))
    .limit(1);
  if (!server) return null;

  await db
    .insert(userMcpServerPreferences)
    .values({ userId, serverId, enabled })
    .onConflictDoUpdate({
      target: [
        userMcpServerPreferences.userId,
        userMcpServerPreferences.serverId,
      ],
      set: { enabled, updatedAt: new Date() },
    });
  await invalidateUserMcpServer(userId, serverId);
  return { ...server, enabled };
}

export async function deleteMcpServer(id: string): Promise<void> {
  await db.delete(mcpServers).where(eq(mcpServers.id, id));
  await invalidateMcpServer(id);
}
