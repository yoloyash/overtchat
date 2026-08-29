import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
  startClaudeRuntime: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));
vi.mock("@overtchat/agent-runtime/claude/client", () => ({
  startClaudeRuntime: mocks.startClaudeRuntime,
}));
vi.mock("@overtchat/agent-runtime/runtime/discovery", () => ({
  parseAgentVersion: (output: string) => output.match(/\d+\.\d+\.\d+/u)?.[0] ?? null,
  shellModesForTarget: () => ["interactive"],
  targetWithShellMode: (target: object, shellMode: string) => ({ ...target, shellMode }),
  targetForConnectionDraft: () => ({ transport: "local" }),
}));

import { probeClaudeTarget } from "./probe";

describe("Claude connection probe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires target authentication and returns SDK models", async () => {
    mocks.executeOnHost
      .mockResolvedValueOnce({ stdout: "2.1.250 (Claude Code)\n", stderr: "" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ loggedIn: true, authMethod: "api_key" }),
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "/workspace\n", stderr: "" });
    const client = {
      getState: vi.fn(async () => ({ sessionId: "session" })),
      getAvailableModels: vi.fn(async () => [
        {
          provider: "claude",
          id: "haiku",
          label: "Haiku",
          api: "claude-agent-sdk",
          baseUrl: "",
          reasoning: false,
          input: ["text", "image"],
          contextWindow: 200_000,
          maxTokens: null,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ]),
      stop: vi.fn(async () => {}),
    };
    mocks.startClaudeRuntime.mockReturnValue(client);

    await expect(
      probeClaudeTarget({ transport: "local" }, "/usr/bin/claude"),
    ).resolves.toMatchObject({
      version: "2.1.250",
      shellMode: "interactive",
      models: [expect.objectContaining({ id: "haiku" })],
    });
    expect(mocks.executeOnHost).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ shellMode: "interactive" }),
      { command: "/usr/bin/claude", args: ["auth", "status", "--json"] },
    );
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it("rejects an unauthenticated target before starting the SDK", async () => {
    mocks.executeOnHost
      .mockResolvedValueOnce({ stdout: "2.1.250\n", stderr: "" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ loggedIn: false }),
        stderr: "",
      });
    await expect(
      probeClaudeTarget({ transport: "local" }, "claude"),
    ).rejects.toThrow("not authenticated");
    expect(mocks.startClaudeRuntime).not.toHaveBeenCalled();
  });
});
