import { describe, expect, it } from "vitest";
import type { AgentSessionListItem } from "@/lib/agents/types";
import {
  AGENT_SESSION_PREVIEW_COUNT,
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
});
