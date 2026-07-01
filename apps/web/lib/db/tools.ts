import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mcpServers, toolSettings } from "@/lib/db/schema";
import type {
  AdminMcpServer,
  McpServerInput,
  ToolSettings,
  ToolSettingsInput,
} from "@/lib/toolConfig";

export const TOOL_SETTINGS_ID = "global";

export type McpServerRow = typeof mcpServers.$inferSelect;
export type ToolSettingsRow = typeof toolSettings.$inferSelect;

export function toAdminMcpServer(row: McpServerRow): AdminMcpServer {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    transport: row.transport,
    command: row.command,
    args: row.args,
    env: row.env,
    cwd: row.cwd,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
  };
}

export async function getToolSettings(): Promise<ToolSettings> {
  const [row] = await db
    .select()
    .from(toolSettings)
    .where(eq(toolSettings.id, TOOL_SETTINGS_ID))
    .limit(1);
  return {
    webSearchEnabled: row?.webSearchEnabled ?? true,
  };
}

export async function updateToolSettings(
  input: ToolSettingsInput,
): Promise<ToolSettings> {
  const [row] = await db
    .insert(toolSettings)
    .values({
      id: TOOL_SETTINGS_ID,
      webSearchEnabled: input.webSearchEnabled,
    })
    .onConflictDoUpdate({
      target: toolSettings.id,
      set: {
        webSearchEnabled: input.webSearchEnabled,
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    webSearchEnabled: row.webSearchEnabled,
  };
}

export async function listMcpServers(): Promise<McpServerRow[]> {
  return db
    .select()
    .from(mcpServers)
    .orderBy(asc(mcpServers.sortOrder), asc(mcpServers.name));
}

export async function listEnabledMcpServers(): Promise<McpServerRow[]> {
  return db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true))
    .orderBy(asc(mcpServers.sortOrder), asc(mcpServers.name));
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
  const slug = await uniqueServerSlug(input.name);
  const [row] = await db
    .insert(mcpServers)
    .values({
      id: crypto.randomUUID(),
      slug,
      ...input,
    })
    .returning();
  return row;
}

export async function updateMcpServer(
  id: string,
  input: McpServerInput,
): Promise<McpServerRow | null> {
  const [row] = await db
    .update(mcpServers)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(mcpServers.id, id))
    .returning();
  return row ?? null;
}

export async function deleteMcpServer(id: string): Promise<void> {
  await db.delete(mcpServers).where(eq(mcpServers.id, id));
}

export function slugifyMcpServerName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "server";
}

async function uniqueServerSlug(name: string): Promise<string> {
  const base = slugifyMcpServerName(name);
  const rows = await db.select({ slug: mcpServers.slug }).from(mcpServers);
  const used = new Set(rows.map((row) => row.slug));
  if (!used.has(base)) return base;

  for (let i = 2; i < 10_000; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, 48 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }

  return `${base.slice(0, 39)}-${crypto.randomUUID().slice(0, 8)}`;
}
