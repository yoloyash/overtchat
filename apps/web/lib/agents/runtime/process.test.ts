import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildSshArgs, buildSshRemoteCommand } from "./process";

describe("SSH process launching", () => {
  it("loads the remote interactive login environment without polluting stdout", () => {
    const command = buildSshRemoteCommand({
      command: "pi",
      args: ["--mode", "rpc"],
      cwd: "/Users/yash/project",
      env: { PI_TEST: "value" },
    });

    expect(command).toContain('exec "${SHELL:-/bin/sh}" -lic');
    expect(command).toContain("3>&1 1>&2");
    expect(command).toContain("exec 1>&3 3>&-");
    expect(command).toContain("cd --");
    expect(command).toContain("PI_TEST=");
    expect(command).toContain("'pi'");
    expect(command).toContain("--mode");
    expect(command).toContain("rpc");
  });

  it("shell-quotes paths, arguments, and environment values", () => {
    const command = buildSshRemoteCommand({
      command: "/opt/pi's/bin/pi",
      args: ["argument with spaces"],
      cwd: "/tmp/project's files",
      env: { PI_VALUE: "it's safe" },
    });

    expect(command).toContain("\\''");
    expect(command).toContain("argument with spaces");
  });

  it("passes configured aliases to OpenSSH without overriding their identities", () => {
    const args = buildSshArgs(
      {
        transport: "ssh",
        hostname: "workstation",
        port: 2222,
        username: "developer",
        hostKey: "workstation ssh-ed25519 AAAATEST",
      },
      { command: "pi", args: ["--mode", "rpc"] },
      { knownHostsPath: "/tmp/overtchat-known-hosts" },
    );

    expect(args).toContain("developer@workstation");
    expect(args).not.toContain("IdentitiesOnly=yes");
    expect(args).not.toContain("-i");
  });

  it("isolates explicitly supplied private keys from other identities", () => {
    const args = buildSshArgs(
      {
        transport: "ssh",
        hostname: "workstation.local",
        port: 22,
        username: "developer",
        hostKey: "workstation.local ssh-ed25519 AAAATEST",
        privateKey: "PRIVATE KEY",
      },
      { command: "pi", args: ["--mode", "rpc"] },
      {
        knownHostsPath: "/tmp/overtchat-known-hosts",
        identityPath: "/tmp/overtchat-identity",
      },
    );

    expect(args).toContain("IdentitiesOnly=yes");
    expect(args).toContain("/tmp/overtchat-identity");
  });
});
