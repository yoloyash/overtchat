import "server-only";
import type { AgentProviderSessionMetadata } from "@/lib/agents/types";
import type { HostTarget } from "@/lib/agents/runtime/process";
import { startCodexAppServer } from "@/lib/agents/codex/app-server";
import {
  codexSessionMetadata,
  parseCodexThread,
  recordOf,
  stringOf,
} from "@/lib/agents/codex/protocol";

const MAX_SESSIONS = 200;
const PAGE_SIZE = 100;

export async function listCodexWorkspaceSessions(
  target: HostTarget,
  executable: string,
  workspacePath: string,
): Promise<AgentProviderSessionMetadata[]> {
  const server = startCodexAppServer(target, executable, workspacePath);
  try {
    await server.ready();
    const sessions: AgentProviderSessionMetadata[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = recordOf(
        await server.request("thread/list", {
          cwd: workspacePath,
          limit: PAGE_SIZE,
          sortKey: "updated_at",
          sortDirection: "desc",
          ...(cursor ? { cursor } : {}),
        }),
      );
      if (!Array.isArray(response?.data)) {
        throw new Error("Codex returned an invalid thread list.");
      }
      for (const value of response.data) {
        const thread = parseCodexThread(value);
        if (thread.cwd === workspacePath) {
          sessions.push(codexSessionMetadata(thread));
        }
        if (sessions.length >= MAX_SESSIONS) return sessions;
      }
      cursor = stringOf(response, "nextCursor") ?? undefined;
      if (cursor && seenCursors.has(cursor)) {
        throw new Error("Codex repeated a thread-list cursor.");
      }
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return sessions;
  } finally {
    await server.stop();
  }
}
