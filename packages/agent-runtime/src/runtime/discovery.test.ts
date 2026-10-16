import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
  inspectHostEnvironment: vi.fn().mockResolvedValue({ platform: "posix" }),
}));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
  inspectHostEnvironment: mocks.inspectHostEnvironment,
}));

import {
  AGENT_INSTALLATION_DISCOVERY_SCRIPT,
  discoverAgentInstallations,
} from "./discovery";

describe("agent installation discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspectHostEnvironment.mockResolvedValue({ platform: "posix" });
  });

  it("discovers Windows executables without POSIX shell retries", async () => {
    mocks.inspectHostEnvironment.mockResolvedValue({ platform: "win32" });
    mocks.executeOnHost.mockResolvedValue({
      stdout: "omp\0C:\\Users\\user\\bin\\omp.exe\0omp 1.2.3\0",
      stderr: "",
    });
    expect(
      await discoverAgentInstallations({ transport: "ssh", alias: "windows" }),
    ).toEqual([
      {
        provider: "omp",
        executable: "C:\\Users\\user\\bin\\omp.exe",
        version: "1.2.3",
        shellMode: "login",
      },
    ]);
    expect(mocks.executeOnHost).toHaveBeenCalledOnce();
    expect(mocks.executeOnHost.mock.calls[0][1].command).toBe("node");
  });

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
        "hermes",
        "/home/test/.local/bin/hermes",
        "Hermes Agent v0.21.5+2372.g678a476 (2026.9.24)",
        "",
      ].join("\0"),
      stderr: "",
    });

    await expect(
      discoverAgentInstallations({ transport: "ssh", alias: "devbox" }),
    ).resolves.toHaveLength(6);
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
