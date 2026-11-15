import { describe, expect, it } from "vitest";
import { agentTurnChangesRow, type AgentTurnChanges } from "@overtchat/agent-bridge";
import {
  agentTurnChangesLabel,
  agentTurnChangesRows,
  buildAgentTurnChangesTree,
  formatAgentChangeCount,
} from "@overtchat/shared/agent-turn-changes";
import {
  agentResponseActions,
  foldAgentTranscript,
  projectAgentTranscript,
} from "./presentation";

const user = (id: string) => ({ role: "user", id, content: id });
const text = (id: string) => ({
  role: "assistant", id, content: [{ type: "text", text: id }],
});
const tool = (id: string) => ({
  role: "assistant", id, content: [{ type: "toolCall", id, name: "bash", arguments: { command: "ls" } }],
});
const result = (id: string) => ({ role: "toolResult", toolCallId: id, content: "ok" });
const changes = (head: string, extra: Partial<AgentTurnChanges> = {}): AgentTurnChanges => ({
  base: "a".repeat(40),
  head: head.repeat(40),
  files: [{ path: "src/app.ts", additions: 3, deletions: 1 }],
  total: { files: 1, additions: 3, deletions: 1 },
  ...extra,
});
const row = (head: string) => agentTurnChangesRow(changes(head), 5);
const types = (items: Array<{ type: string }>) => items.map((item) => item.type);

describe("what a turn changed, in the transcript", () => {
  it("shows a turn's changes under its answer and keeps them when the work folds", () => {
    const messages = [user("u"), text("progress"), tool("cmd"), result("cmd"), text("answer"), row("b")];
    const projected = projectAgentTranscript(messages);
    expect(projected.at(-1)).toMatchObject({
      type: "turn_changes",
      key: `turn-changes:${"b".repeat(40)}`,
      changes: { total: { files: 1, additions: 3, deletions: 1 } },
    });
    expect(types(foldAgentTranscript(projected, { unsettled: false, expanded: new Set() })))
      .toEqual(["message", "work_summary", "assistant_text", "turn_changes"]);

    // Other hidden rows, and a row this client cannot read, stay hidden.
    expect(types(projectAgentTranscript([
      user("u"),
      { role: "custom", customType: "other", display: false },
      { ...row("b"), changes: { files: "many" } },
    ]))).toEqual(["message"]);
  });

  it("puts the turn's actions under its changes", () => {
    const messages = [user("u"), text("answer"), row("b"), user("next"), text("plain")];
    const projected = projectAgentTranscript(messages);
    const actions = agentResponseActions(projected, false);
    expect([...actions.entries()]).toEqual([
      [projected[2].key, { text: "answer", messageId: "answer" }],
      [projected[4].key, { text: "plain", messageId: "plain" }],
    ]);
    expect(projected[2].type).toBe("turn_changes");
    // A stopped turn without an answer still lists what it changed.
    const stopped = projectAgentTranscript([user("u"), tool("cmd"), row("c")]);
    expect(types(stopped)).toEqual(["message", "activity", "turn_changes"]);
    expect(agentResponseActions(stopped, false).size).toBe(0);
  });

  it("reads a turn's changes above a footer recorded before them", () => {
    const projected = projectAgentTranscript([
      user("u"),
      { ...text("answer"), overtchatTurnId: "turn-1" },
      { role: "turnFooter", content: "answer", messageId: "answer", durationMs: 4000, overtchatTurnId: "turn-1", timestamp: 4 },
      row("b"),
      user("next"),
    ]);
    expect(types(projected)).toEqual([
      "message", "assistant_text", "turn_changes", "turn_footer", "message",
    ]);
    expect(projected[2]).toMatchObject({ turnId: "turn-1", timestamp: 5 });
    expect(projected[3]).toMatchObject({ turnId: "turn-1", timestamp: 4 });
    expect(types(foldAgentTranscript(projected, { unsettled: false, expanded: new Set() })))
      .toEqual(types(projected));
    expect([...agentResponseActions(projected, false).keys()]).toEqual([projected[3].key]);
  });
});

describe("changed files tree", () => {
  it("lists folders first, joins folders that hold nothing else, and adds up their lines", () => {
    const tree = buildAgentTurnChangesTree({
      files: [
        { path: "README.md", additions: 1, deletions: 0 },
        { path: "apps/web/lib/b10.ts", additions: 5, deletions: 2 },
        { path: "apps/web/lib/b2.ts", additions: 1, deletions: 1 },
        { path: "apps/web/page.tsx", previousPath: "apps/web/home.tsx", additions: 0, deletions: 0 },
        { path: "packages/shared/src/index.ts", additions: 2, deletions: 0 },
      ],
    });
    const names = (open: (path: string) => boolean) =>
      agentTurnChangesRows(tree, open).map(({ node, depth }) =>
        `${"  ".repeat(depth)}${node.name} +${node.additions} -${node.deletions}`);
    expect(names(() => false)).toEqual([
      "apps/web +6 -3",
      "packages/shared/src +2 -0",
      "README.md +1 -0",
    ]);
    expect(names(() => true)).toEqual([
      "apps/web +6 -3",
      "  lib +6 -3",
      "    b2.ts +1 -1",
      "    b10.ts +5 -2",
      "  page.tsx +0 -0",
      "packages/shared/src +2 -0",
      "  index.ts +2 -0",
      "README.md +1 -0",
    ]);
    expect(names((path) => path === "apps/web")).toHaveLength(5);
    const renamed = agentTurnChangesRows(tree, () => true)
      .find(({ node }) => node.name === "page.tsx")?.node;
    expect(renamed).toMatchObject({
      path: "apps/web/page.tsx",
      workspacePath: "apps/web/page.tsx",
      previousPath: "apps/web/home.tsx",
    });
  });

  it("shows and opens files from the workspace's folder", () => {
    const tree = buildAgentTurnChangesTree({
      workspacePath: "packages/app",
      files: [
        { path: "packages/app/index.ts", additions: 1, deletions: 0 },
        { path: "packages/app/src/old.ts", previousPath: "packages/app/old.ts", additions: 0, deletions: 0 },
        { path: "packages/application/other.ts", additions: 1, deletions: 0 },
      ],
    });
    const files = agentTurnChangesRows(tree, () => true)
      .flatMap(({ node }) => node.kind === "file" ? [node] : []);
    expect(files.map(({ path, workspacePath, previousPath }) => ({ path, workspacePath, previousPath })))
      .toEqual([
        { path: "packages/application/other.ts", workspacePath: null, previousPath: null },
        { path: "src/old.ts", workspacePath: "src/old.ts", previousPath: "old.ts" },
        { path: "index.ts", workspacePath: "index.ts", previousPath: null },
      ]);
  });

  it("words the count and keeps large line counts short", () => {
    expect(agentTurnChangesLabel(1)).toBe("1 changed file");
    expect(agentTurnChangesLabel(1200)).toBe("1,200 changed files");
    expect([0, 999, 1000, 1250, 9960, 15499, 999499, 999500, 2400000].map(formatAgentChangeCount))
      .toEqual(["0", "999", "1k", "1.3k", "10k", "15k", "999k", "1m", "2.4m"]);
  });
});
