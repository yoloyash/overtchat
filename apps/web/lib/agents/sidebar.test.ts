import { describe, expect, it } from "vitest";
import type {
  AgentConnectionListItem,
  AgentSessionListItem,
} from "@/lib/agents/types";
import {
  AGENT_SESSION_PREVIEW_COUNT,
  agentConnectionHasRunningSession,
  agentWorkspaceHasRunningSession,
  visibleAgentSessions,
} from "./sidebar";

function sessions(count: number): AgentSessionListItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    providerSessionId: `provider-${index}`,
    name: `Session ${index}`,
    firstMessage: null,
    messageCount: 0,
    createdAt: index,
    modifiedAt: index,
    runtimeStatus: "idle",
  }));
}

describe("agent sessions in the sidebar", () => {
  it("shows only the recent preview until expanded", () => {
    const all = sessions(20);
    expect(visibleAgentSessions(all, false, null)).toHaveLength(
      AGENT_SESSION_PREVIEW_COUNT,
    );
    expect(visibleAgentSessions(all, true, null)).toEqual(all);
  });

  it("keeps an older active session visible without expanding everything", () => {
    const all = sessions(20);
    const visible = visibleAgentSessions(all, false, "session-15");
    expect(visible).toHaveLength(AGENT_SESSION_PREVIEW_COUNT + 1);
    expect(visible.at(-1)?.id).toBe("session-15");
  });

  it("keeps running sessions visible outside the recent preview", () => {
    const all = sessions(20);
    all[15]!.runtimeStatus = "running";

    const visible = visibleAgentSessions(all, false, "session-14");

    expect(visible.map((session) => session.id)).toEqual([
      ...all.slice(0, AGENT_SESSION_PREVIEW_COUNT).map((session) => session.id),
      "session-14",
      "session-15",
    ]);
  });

  it("reports running activity through workspace and connection ancestors", () => {
    const all = sessions(2);
    all[1]!.runtimeStatus = "running";
    const connection: AgentConnectionListItem = {
      id: "connection",
      provider: "pi",
      executable: "pi",
      detectedVersion: null,
      lastValidatedAt: null,
      host: {
        id: "host",
        connectorId: "connector",
        name: "This machine",
        transport: "local",
        sshAlias: null,
      },
      workspaces: [
        {
          id: "workspace",
          path: "/workspace",
          name: "workspace",
          sessions: all,
        },
      ],
    };

    expect(agentWorkspaceHasRunningSession(connection.workspaces[0]!)).toBe(
      true,
    );
    expect(agentConnectionHasRunningSession(connection)).toBe(true);
  });
});
