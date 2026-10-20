import { describe, expect, it } from "vitest";
import type { AgentRuntimeSnapshot } from "./agents";
import { agentHistoryPage, windowAgentSnapshot } from "./transcript";
import { prependAgentHistoryPage } from "./replica";

function snapshot(): AgentRuntimeSnapshot {
  return {
    sessionId: "session",
    status: "idle",
    messages: Array.from({ length: 35 }, (_, index) => [
      {
        id: `user-${index}`,
        role: "user",
        overtchatTurnId: `turn-${index}`,
        content: `prompt-${index}`,
      },
      {
        id: `answer-${index}`,
        role: "assistant",
        overtchatTurnId: `turn-${index}`,
        content: `answer-${index}`,
      },
    ]).flat(),
  } as AgentRuntimeSnapshot;
}

describe("agent transcript windows", () => {
  it("loads the latest ten prompts and reconstructs all history with stable cursors", () => {
    const original = snapshot();
    const cursor = { epoch: "epoch", sequence: 7 };
    let replica = {
      snapshot: windowAgentSnapshot(original, cursor.epoch),
      cursor,
    };
    expect(replica.snapshot.messages).toEqual(original.messages.slice(50));
    let pages = 0;
    while (replica.snapshot.history?.beforeCursor) {
      const page = agentHistoryPage(
        original,
        cursor,
        replica.snapshot.history.beforeCursor,
      );
      replica = prependAgentHistoryPage(replica, page) as typeof replica;
      pages++;
    }
    expect(pages).toBe(3);
    expect(replica.snapshot.messages).toEqual(original.messages);
    expect(original.history).toBeUndefined();
    expect(original.messages).toHaveLength(70);
  });

  it("retains a whole native turn with more than ten steered user messages", () => {
    const original = snapshot();
    original.messages = original.messages.map((m) => ({
      ...(m as object),
      overtchatTurnId: "one-native-turn",
    }));
    expect(windowAgentSnapshot(original, "epoch").messages).toEqual(
      original.messages,
    );
  });

  it("does not resurrect history after epoch changes, rewind, or a concurrent reset", () => {
    const original = snapshot();
    const cursor = { epoch: "epoch", sequence: 7 };
    const recent = windowAgentSnapshot(original, cursor.epoch);
    const anchor = recent.history!.beforeCursor!;
    const page = agentHistoryPage(original, cursor, anchor);
    expect(() =>
      agentHistoryPage(original, { ...cursor, epoch: "new" }, anchor),
    ).toThrow("history changed");
    expect(() =>
      agentHistoryPage(
        { ...original, messages: original.messages.slice(5) },
        cursor,
        anchor,
      ),
    ).toThrow("history changed");
    expect(() =>
      prependAgentHistoryPage(
        { snapshot: recent, cursor: { epoch: "new", sequence: 7 } },
        page,
      ),
    ).toThrow("history changed");
    expect(() =>
      prependAgentHistoryPage(
        {
          snapshot: { ...recent, history: { beforeCursor: "another-page" } },
          cursor,
        },
        page,
      ),
    ).toThrow("history changed");
    expect(
      prependAgentHistoryPage(
        { snapshot: recent, cursor: { ...cursor, sequence: 8 } },
        page,
      ).cursor!.sequence,
    ).toBe(8);
  });
});
