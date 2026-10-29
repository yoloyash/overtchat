import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";
import {
  listClaudeWorkspaceSessions,
  readClaudeSessionMessages,
  renameClaudeSession,
} from "./sessions";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.CLAUDE_CONFIG_DIR;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Claude target session storage", () => {
  it("lists, replays, and renames tolerant JSONL history", async () => {
    configureLocalTestProcessSpawner();
    const root = await mkdtemp(join(tmpdir(), "overtchat-claude-"));
    temporaryDirectories.push(root);
    const config = join(root, "config");
    const project = join(config, "projects", "-workspace");
    const workspace = join(root, "workspace");
    await mkdir(project, { recursive: true });
    await mkdir(workspace, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = config;
    const sessionId = "00000000-0000-4000-8000-000000000001";
    const sessionPath = join(project, `${sessionId}.jsonl`);
    await writeFile(
      sessionPath,
      [
        "not-json",
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: workspace,
          sessionId,
          message: { role: "user", content: "Repair the build" },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          timestamp: "2026-01-01T00:00:01.000Z",
          cwd: workspace,
          sessionId,
          message: {
            role: "assistant",
            model: "haiku",
            content: [
              { type: "thinking", thinking: "Inspecting" },
              { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test" } },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          uuid: "tool-result-1",
          timestamp: "2026-01-01T00:00:02.000Z",
          cwd: workspace,
          sessionId,
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tool-1", content: "passed" }],
          },
        }),
      ].join("\n") + "\n",
    );

    const sessions = await listClaudeWorkspaceSessions(
      { transport: "local" },
      workspace,
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      providerSessionId: sessionId,
      firstMessage: "Repair the build",
      messageCount: 3,
      launchConfig: { model: "haiku" },
    });
    expect(await readClaudeSessionMessages({ transport: "local" }, sessionPath)).toEqual([
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({
        role: "assistant",
        content: expect.arrayContaining([
          expect.objectContaining({ type: "thinking" }),
          expect.objectContaining({ type: "toolCall", id: "tool-1" }),
        ]),
      }),
      expect.objectContaining({ role: "toolResult", toolCallId: "tool-1" }),
    ]);

    await renameClaudeSession(
      { transport: "local" },
      sessionPath,
      sessionId,
      "Repair session",
    );
    expect(
      await listClaudeWorkspaceSessions({ transport: "local" }, workspace),
    ).toContainEqual(expect.objectContaining({ name: "Repair session" }));
  });

  it("replays compactions as dividers without Claude's bookkeeping turns", async () => {
    configureLocalTestProcessSpawner();
    const root = await mkdtemp(join(tmpdir(), "overtchat-claude-"));
    temporaryDirectories.push(root);
    const sessionPath = join(root, "session.jsonl");
    const user = (uuid: string, content: string, flags: Record<string, unknown> = {}) =>
      JSON.stringify({
        type: "user", uuid, timestamp: "2026-01-01T00:00:00.000Z", ...flags,
        message: { role: "user", content },
      });
    const boundary = (uuid: string, compactMetadata: Record<string, unknown>) =>
      JSON.stringify({
        type: "system", subtype: "compact_boundary", uuid,
        timestamp: "2026-01-01T00:00:01.000Z", content: "Conversation compacted", compactMetadata,
      });
    // Entry order and flags as Claude Code 2.1.305-2.1.310 journal them.
    await writeFile(sessionPath, [
      user("user-1", "Repair the build"),
      boundary("boundary-1", { trigger: "manual", preTokens: 210_677, postTokens: 11_152 }),
      user("summary-1", "This session is being continued from a previous conversation.", {
        isVisibleInTranscriptOnly: true, isCompactSummary: true,
      }),
      user("caveat-1", "<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>", {
        isMeta: true,
      }),
      user("command-1", "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>"),
      user("stdout-1", "<local-command-stdout>Compacted </local-command-stdout>"),
      user("user-2", "Keep going"),
      boundary("boundary-2", { trigger: "auto", preTokens: 967_944 }),
      user("summary-2", "This session is being continued from a previous conversation.", {
        isVisibleInTranscriptOnly: true, isCompactSummary: true,
      }),
      user("user-3", "<local-command-stdout>printed by a later command</local-command-stdout>"),
    ].join("\n") + "\n");

    expect(await readClaudeSessionMessages({ transport: "local" }, sessionPath)).toEqual([
      expect.objectContaining({ role: "user", id: "user-1" }),
      {
        id: "compaction:boundary-1", role: "compactionSummary", status: "completed",
        trigger: "manual", tokensBefore: 210_677,
        timestamp: Date.parse("2026-01-01T00:00:01.000Z"),
      },
      expect.objectContaining({ role: "user", id: "user-2" }),
      {
        id: "compaction:boundary-2", role: "compactionSummary", status: "completed",
        trigger: "auto", tokensBefore: 967_944,
        timestamp: Date.parse("2026-01-01T00:00:01.000Z"),
      },
      expect.objectContaining({ role: "user", id: "user-3" }),
    ]);
  });
});
