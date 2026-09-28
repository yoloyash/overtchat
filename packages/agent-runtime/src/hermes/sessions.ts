import type { AgentProviderSessionMetadata } from "@overtchat/agent-bridge";
import { AcpConnection } from "../acp/connection";
import type { HostTarget } from "../runtime/process";

export async function listHermesSessions(
  target: HostTarget,
  executable: string,
  cwd: string,
): Promise<AgentProviderSessionMetadata[]> {
  const connection = await AcpConnection.start(
    target,
    { command: executable, args: ["acp"], cwd },
    "Hermes",
    {
      sessionUpdate: async () => {},
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    },
    () => {},
  );
  try {
    const initialized = await connection.initialize();
    if (!initialized.agentCapabilities?.sessionCapabilities?.list) {
      throw new Error(
        "Hermes does not advertise session listing. Update Hermes on the execution host.",
      );
    }
    const sessions = new Map<string, AgentProviderSessionMetadata>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await connection.request(
        connection.rpc.listSessions({ cwd, ...(cursor ? { cursor } : {}) }),
        "list sessions",
      );
      for (const session of page.sessions) {
        // A provider must not import conversations from a different workspace.
        if (session.cwd.replace(/\/+$/u, "") !== cwd.replace(/\/+$/u, ""))
          continue;
        const modifiedAt = session.updatedAt
          ? new Date(session.updatedAt)
          : null;
        sessions.set(session.sessionId, {
          providerSessionId: session.sessionId,
          providerSessionPath: session.sessionId,
          name: session.title ?? null,
          firstMessage: null,
          messageCount: 0,
          createdAt: null,
          modifiedAt:
            modifiedAt && Number.isFinite(modifiedAt.getTime())
              ? modifiedAt
              : null,
        });
      }
      cursor = page.nextCursor ?? undefined;
      if (cursor && cursors.has(cursor))
        throw new Error("Hermes repeated a session-list cursor.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...sessions.values()];
  } finally {
    await connection.stop();
  }
}
