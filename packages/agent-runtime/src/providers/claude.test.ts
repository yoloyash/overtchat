import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startClaudeRuntime: vi.fn(),
  probeClaudeConnection: vi.fn(),
  probeClaudeTarget: vi.fn(),
  listClaudeWorkspaceSessions: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/claude/client", () => ({
  startClaudeRuntime: mocks.startClaudeRuntime,
}));
vi.mock("@overtchat/agent-runtime/claude/probe", () => ({
  probeClaudeConnection: mocks.probeClaudeConnection,
  probeClaudeTarget: mocks.probeClaudeTarget,
}));
vi.mock("@overtchat/agent-runtime/claude/sessions", () => ({
  listClaudeWorkspaceSessions: mocks.listClaudeWorkspaceSessions,
}));

import { claudeProviderAdapter } from "./claude";

describe("Claude provider adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("launches and resumes through the target-owned runtime", () => {
    const client = {};
    mocks.startClaudeRuntime.mockReturnValue(client);
    const target = { transport: "ssh" as const, alias: "workstation" };
    const launch = {
      executable: "/usr/bin/claude",
      cwd: "/workspace",
      model: "haiku",
      thinkingOptionId: "medium",
      modeId: "auto",
      resume: {
        providerSessionId: "00000000-0000-4000-8000-000000000001",
        providerSessionPath: "/home/user/.claude/projects/project/session.jsonl",
      },
    };
    expect(claudeProviderAdapter.startSession(target, launch)).toBe(client);
    expect(mocks.startClaudeRuntime).toHaveBeenCalledWith(target, launch);
  });

  it("owns identity, terminal events, and generic command normalization", () => {
    expect(
      claudeProviderAdapter.sessionIdentity({
        sessionId: "session",
        sessionFile: "/session.jsonl",
        sessionName: "Repair",
      }),
    ).toEqual({
      providerSessionId: "session",
      providerSessionPath: "/session.jsonl",
      sessionName: "Repair",
    });
    expect(
      claudeProviderAdapter.createEventClassifier().classify({ type: "turn_end" }),
    ).toEqual({ started: false, terminal: true });
    expect(
      claudeProviderAdapter.normalizeCommand(
        { type: "prompt", message: "/compact" },
        {},
      ),
    ).toEqual({ type: "compact" });
    expect(() =>
      claudeProviderAdapter.normalizeCommand(
        { type: "set_auto_compaction", enabled: true },
        {},
      ),
    ).toThrow("manages context compaction automatically");
  });
});
