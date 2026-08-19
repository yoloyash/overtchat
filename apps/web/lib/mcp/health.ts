import "server-only";
import type { McpServerRow } from "@/lib/db/mcpServers";
import type { McpServerHealth } from "@/lib/mcp/schema";
import { connectMcpServer } from "@/lib/mcp/runtime";

export async function checkMcpServerHealth(
  server: McpServerRow,
): Promise<McpServerHealth> {
  const startedAt = Date.now();
  try {
    const connection = await connectMcpServer(server);
    const toolCount = Object.keys(connection.rawTools).length;
    await connection.close();
    return { ok: true, elapsedMs: Date.now() - startedAt, toolCount };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
