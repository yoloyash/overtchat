import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
  startCodexAppServer: vi.fn(),
}));

vi.mock("@/lib/agents/runtime/discovery", () => ({
  parseAgentVersion: (stdout: string) =>
    /codex-cli\s+(\S+)/u.exec(stdout)?.[1] ?? null,
  shellModesForTarget: () => ["interactive", "login"],
  targetForConnectionDraft: () => ({
    connectorId: "connector",
    transport: "local",
  }),
  targetWithShellMode: (
    target: Record<string, unknown>,
    shellMode: string,
  ) => ({ ...target, shellMode }),
}));

vi.mock("@/lib/agents/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));

vi.mock("./app-server", () => ({
  startCodexAppServer: mocks.startCodexAppServer,
}));

import { probeCodexTarget } from "./probe";

describe("Codex connection probing", () => {
  const server = {
    ready: vi.fn(async () => {}),
    request: vi.fn(),
    stop: vi.fn(async () => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startCodexAppServer.mockReturnValue(server);
    server.request.mockImplementation(async (method: string) => {
      if (method === "account/read") {
        return { account: { type: "chatgpt" }, requiresOpenaiAuth: true };
      }
      if (method === "model/list") {
        return {
          data: [
            {
              model: "gpt-5.6",
              displayName: "GPT-5.6",
              inputModalities: ["text"],
              supportedReasoningEfforts: [],
            },
          ],
        };
      }
      return {};
    });
  });

  it("falls back to the login shell and verifies app-server readiness", async () => {
    mocks.executeOnHost
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce({
        stdout: "codex-cli 0.147.0\n",
        stderr: "",
      });

    await expect(
      probeCodexTarget(
        { connectorId: "connector", transport: "local" },
        "/opt/bin/codex",
      ),
    ).resolves.toMatchObject({
      status: "ready",
      version: "0.147.0",
      shellMode: "login",
      models: [
        expect.objectContaining({
          provider: "codex",
          id: "gpt-5.6",
        }),
      ],
    });
    expect(mocks.startCodexAppServer).toHaveBeenCalledWith(
      expect.objectContaining({ shellMode: "login" }),
      "/opt/bin/codex",
    );
    expect(server.stop).toHaveBeenCalledOnce();
  });

  it("reports missing authentication and still stops app-server", async () => {
    mocks.executeOnHost.mockResolvedValue({
      stdout: "codex-cli 0.147.0\n",
      stderr: "",
    });
    server.request.mockImplementation(async (method: string) =>
      method === "account/read"
        ? { account: null, requiresOpenaiAuth: true }
        : { data: [] },
    );

    await expect(
      probeCodexTarget(
        { connectorId: "connector", transport: "local" },
        "codex",
      ),
    ).rejects.toThrow("Codex is installed but not signed in");
    expect(server.stop).toHaveBeenCalledOnce();
  });
});
