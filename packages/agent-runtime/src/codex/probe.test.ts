import { beforeEach, describe, expect, it, vi } from "vitest";


const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
  startCodexAppServer: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/runtime/discovery", () => ({
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

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));

vi.mock("./app-server", () => ({
  startCodexAppServer: mocks.startCodexAppServer,
}));

import { fetchCodexModels, probeCodexTarget } from "./probe";

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
        { transport: "local" },
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
      undefined,
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
        { transport: "local" },
        "codex",
      ),
    ).rejects.toThrow("Codex is installed but not signed in");
    expect(server.stop).toHaveBeenCalledOnce();
  });

  it("discovers a configured local model without OpenAI login in the workspace context", async () => {
    server.request.mockImplementation(async (method: string) => {
      if (method === "account/read") return { account: null, requiresOpenaiAuth: false };
      if (method === "config/read") return { config: { model: "local/qwen", model_provider: "vllm" } };
      if (method === "model/list") return { data: [{ model: "gpt-default", isDefault: true }] };
      return {};
    });
    await expect(fetchCodexModels({ transport: "ssh", alias: "host" }, "codex", "/project"))
      .resolves.toEqual([expect.objectContaining({ id: "local/qwen", isDefault: true })]);
    expect(mocks.startCodexAppServer).toHaveBeenCalledWith({ transport: "ssh", alias: "host" }, "codex", "/project");
    expect(server.request).toHaveBeenCalledWith("config/read", { cwd: "/project" });
    expect(server.stop).toHaveBeenCalledOnce();
  });
});
