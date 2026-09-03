import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ executeOnHost: vi.fn() }));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));

import {
  AGENT_INSTALLATION_DISCOVERY_SCRIPT,
  discoverAgentInstallations,
} from "./discovery";

describe("agent installation discovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("discovers and versions all providers in one host execution", async () => {
    mocks.executeOnHost.mockResolvedValue({
      stdout: [
        "codex",
        "/usr/local/bin/codex",
        "codex-cli 1.2.3",
        "claude",
        "/usr/local/bin/claude",
        "2.3.4 (Claude Code)",
        "pi",
        "/usr/local/bin/pi",
        "pi 3.4.5",
        "omp",
        "/usr/local/bin/omp",
        "omp 4.5.6",
        "opencode",
        "/usr/local/bin/opencode",
        "opencode 5.6.7",
        "",
      ].join("\0"),
      stderr: "",
    });

    await expect(
      discoverAgentInstallations({ transport: "ssh", alias: "devbox" }),
    ).resolves.toHaveLength(5);
    expect(mocks.executeOnHost).toHaveBeenCalledOnce();
    expect(mocks.executeOnHost).toHaveBeenCalledWith(
      { transport: "ssh", alias: "devbox", shellMode: "interactive" },
      expect.objectContaining({
        command: "/bin/sh",
        args: expect.arrayContaining([
          "-c",
          AGENT_INSTALLATION_DISCOVERY_SCRIPT,
          "overtchat-agent-discovery",
        ]),
      }),
    );
  });

  it("falls back to the alternate shell mode and ignores invalid versions", async () => {
    mocks.executeOnHost
      .mockResolvedValueOnce({
        stdout: "codex\0/usr/local/bin/codex\0not-a-version\0",
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: "codex\0/usr/local/bin/codex\0codex 1.2.3\0",
        stderr: "",
      });

    await expect(
      discoverAgentInstallations({ transport: "local" }),
    ).resolves.toEqual([
      {
        provider: "codex",
        executable: "/usr/local/bin/codex",
        version: "1.2.3",
        shellMode: "login",
      },
    ]);
    expect(mocks.executeOnHost).toHaveBeenCalledTimes(2);
  });
});
