import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
  startPiRpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));
vi.mock("@/lib/agents/pi/client", () => ({
  startPiRpc: mocks.startPiRpc,
}));

import {
  discoverAgentInstallations,
  probeAgentConnection,
  probeAgentTarget,
} from "./probe";

const connectorId = "11111111-1111-4111-8111-111111111111";
const model = {
  id: "model",
  name: "Model",
  provider: "openai",
  api: "openai-responses",
  baseUrl: "",
  reasoning: true,
  input: ["text"],
  contextWindow: 128_000,
  maxTokens: 128_000,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
};

describe("agent connection probing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeOnHost.mockResolvedValue({
      stdout: "omp/17.2.1\n",
      stderr: "",
    });
    mocks.startPiRpc.mockReturnValue({
      getState: vi.fn(async () => ({ isStreaming: false })),
      getAvailableModels: vi.fn(async () => [model]),
      stop: vi.fn(async () => {}),
    });
  });

  it("passes an exact SSH alias through the connector boundary", async () => {
    await expect(
      probeAgentConnection({
        connectorId,
        provider: "omp",
        transport: "ssh",
        name: "MacBook",
        executable: "omp",
        sshAlias: "macbook",
      }),
    ).resolves.toMatchObject({
      status: "ready",
      version: "17.2.1",
      shellMode: "interactive",
    });

    const target = {
      connectorId,
      transport: "ssh" as const,
      alias: "macbook",
      shellMode: "interactive" as const,
    };
    expect(mocks.executeOnHost).toHaveBeenCalledWith(target, {
      command: "omp",
      args: ["--version"],
    });
    expect(mocks.startPiRpc).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ provider: "omp", executable: "omp" }),
    );
  });

  it("uses OMP's supported model-discovery flags", async () => {
    await probeAgentConnection({
      connectorId,
      provider: "omp",
      transport: "local",
      name: "Local OMP",
      executable: "omp",
    });

    expect(mocks.startPiRpc).toHaveBeenCalledWith(
      {
        connectorId,
        transport: "local",
        shellMode: "interactive",
      },
      expect.objectContaining({
        provider: "omp",
        executable: "omp",
        extraArgs: ["--no-extensions", "--no-skills", "--no-rules"],
      }),
    );
  });

  it("always stops the probe RPC process after discovery fails", async () => {
    const stop = vi.fn(async () => {});
    mocks.startPiRpc.mockReturnValue({
      getState: vi.fn(async () => ({ isStreaming: false })),
      getAvailableModels: vi.fn(async () => []),
      stop,
    });

    await expect(
      probeAgentConnection({
        connectorId,
        provider: "pi",
        transport: "local",
        name: "Local Pi",
        executable: "pi",
      }),
    ).rejects.toThrow("did not report any usable models");
    expect(stop).toHaveBeenCalledOnce();
  });

  it("discovers supported agents from absolute login PATH entries", async () => {
    mocks.executeOnHost
      .mockResolvedValueOnce({
        stdout:
          "pi\0/home/developer/.local/bin/pi\0" +
          "omp\0/home/developer/.bun/bin/omp\0",
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "pi 0.42.3\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "omp/17.2.10\n", stderr: "" });

    await expect(
      discoverAgentInstallations({
        connectorId,
        transport: "ssh",
        alias: "devbox",
      }),
    ).resolves.toEqual([
      {
        provider: "pi",
        executable: "/home/developer/.local/bin/pi",
        version: "0.42.3",
      },
      {
        provider: "omp",
        executable: "/home/developer/.bun/bin/omp",
        version: "17.2.10",
      },
    ]);
    expect(mocks.executeOnHost).toHaveBeenNthCalledWith(
      2,
      {
        connectorId,
        transport: "ssh",
        alias: "devbox",
        shellMode: "interactive",
      },
      {
        command: "/home/developer/.local/bin/pi",
        args: ["--version"],
      },
    );
  });

  it("ignores aliases, missing commands, and invalid agent versions", async () => {
    mocks.executeOnHost
      .mockResolvedValueOnce({
        stdout: "pi\0alias pi='other'\0omp\0/opt/bin/omp\0",
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "not omp\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    await expect(
      discoverAgentInstallations({
        connectorId,
        transport: "local",
      }),
    ).resolves.toEqual([]);
  });

  it("falls back to the login shell when interactive startup fails", async () => {
    mocks.executeOnHost
      .mockRejectedValueOnce(new Error("interactive startup failed"))
      .mockResolvedValueOnce({
        stdout: "omp/17.2.1\n",
        stderr: "",
      });

    await expect(
      probeAgentConnection({
        connectorId,
        provider: "omp",
        transport: "ssh",
        name: "MacBook",
        executable: "/Users/yash/.bun/bin/omp",
        sshAlias: "macbook",
      }),
    ).resolves.toMatchObject({
      status: "ready",
      shellMode: "login",
    });
    expect(mocks.startPiRpc).toHaveBeenCalledWith(
      {
        connectorId,
        transport: "ssh",
        alias: "macbook",
        shellMode: "login",
      },
      expect.objectContaining({
        executable: "/Users/yash/.bun/bin/omp",
      }),
    );
  });

  it("tries the stored shell mode first during revalidation", async () => {
    await probeAgentTarget(
      {
        connectorId,
        transport: "local",
        shellMode: "login",
      },
      "omp",
      "omp",
    );

    expect(mocks.executeOnHost).toHaveBeenCalledTimes(1);
    expect(mocks.executeOnHost).toHaveBeenCalledWith(
      {
        connectorId,
        transport: "local",
        shellMode: "login",
      },
      {
        command: "omp",
        args: ["--version"],
      },
    );
  });
});
