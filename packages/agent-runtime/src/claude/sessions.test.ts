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
  it("replays Task launches as subagent parts fed by their child journals", async () => {
    configureLocalTestProcessSpawner();
    const root = await mkdtemp(join(tmpdir(), "overtchat-claude-"));
    temporaryDirectories.push(root);
    const sessionPath = join(root, "session.jsonl");
    const subagents = join(root, "session", "subagents");
    await mkdir(subagents, { recursive: true });
    const entry = (type: string, uuid: string, content: unknown, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ type, uuid, timestamp: "2026-01-01T00:00:00.000Z", ...extra, message: { role: type, content } });
    const launch = (id: string, description: string) =>
      ({ type: "tool_use", id, name: "Task", input: { description, prompt: "Read it", subagent_type: "Explore" } });
    await writeFile(sessionPath, [
      entry("user", "user-1", "Survey the runtime"),
      entry("assistant", "assistant-1", [launch("task-1", "Survey tests"), launch("task-2", "Survey docs"), launch("task-3", "Survey CI")]),
      entry("user", "result-1", [{ type: "tool_result", tool_use_id: "task-1", content: "Async agent launched successfully.\nagentId: a1" }]),
      entry("user", "result-2", [{ type: "tool_result", tool_use_id: "task-2", content: "[Request interrupted by user for tool use]", is_error: true }]),
      entry("user", "result-3", [{ type: "tool_result", tool_use_id: "task-3", content: "Done." }]),
      entry("user", "wake-1", "<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>"),
      entry("assistant", "assistant-2", [{ type: "text", text: "All surveyed." }]),
    ].join("\n") + "\n");
    await writeFile(join(subagents, "agent-a1.meta.json"), JSON.stringify({
      agentType: "Explore", description: "Survey tests", toolUseId: "task-1", finished: true,
    }));
    await writeFile(join(subagents, "agent-a1.jsonl"), [
      entry("user", "child-user", "Read it", { isSidechain: true, agentId: "a1" }),
      entry("assistant", "child-1", [{ type: "tool_use", id: "child-grep", name: "Grep", input: { pattern: "runtimeStatus" } }], { isSidechain: true, agentId: "a1" }),
      entry("user", "child-2", [{ type: "tool_result", tool_use_id: "child-grep", content: "No such path\nmore", is_error: true }], { isSidechain: true, agentId: "a1" }),
      entry("assistant", "child-3", [{ type: "text", text: "The suite covers the runtime." }], { isSidechain: true, agentId: "a1" }),
    ].join("\n") + "\n");
    await writeFile(join(subagents, "agent-a2.meta.json"), JSON.stringify({
      agentType: "Explore", description: "Survey docs", toolUseId: "task-2", finished: false,
    }));
    await writeFile(join(subagents, "agent-a2.jsonl"), "");

    expect(await readClaudeSessionMessages({ transport: "local" }, sessionPath)).toEqual([
      expect.objectContaining({ role: "user", id: "user-1" }),
      expect.objectContaining({
        role: "assistant",
        content: [
          {
            type: "subagent", id: "task-1", action: "task", status: "completed", receivers: [],
            prompt: "Read it", title: "Survey tests", agentType: "Explore",
            events: ["Grep runtimeStatus", "Grep failed: No such path", "The suite covers the runtime."],
          },
          expect.objectContaining({ id: "task-2", status: "stopped", events: [] }),
          expect.objectContaining({ id: "task-3", status: "completed", events: [] }),
        ],
      }),
      expect.objectContaining({ role: "assistant", id: "assistant-2" }),
    ]);
  });
});
