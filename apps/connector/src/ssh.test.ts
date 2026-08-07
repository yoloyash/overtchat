import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSshRemoteCommand,
  listSshHosts,
  parseSshExpansion,
  sshSpawnArgs,
} from "./ssh.js";

const temporaryPaths: string[] = [];
const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const temporaryPath of temporaryPaths.splice(0)) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
  }
});

describe("SSH process launching", () => {
  it("passes the configured alias to OpenSSH unchanged", () => {
    const args = sshSpawnArgs("macbook", {
      command: "omp",
      args: ["--mode", "rpc"],
    });

    expect(args).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "macbook",
      expect.any(String),
    ]);
    expect(args).not.toContain("user@macbook");
    expect(args).not.toContain("-i");
  });

  it("loads the remote login environment without an interactive shell", () => {
    const command = buildSshRemoteCommand({
      command: "/Users/yash/.bun/bin/omp",
      args: ["--mode", "rpc", "argument with spaces"],
      cwd: "/Users/yash/project's files",
      env: { OVERTCHAT_TEST: "it's safe" },
    });

    expect(command).toContain('exec "${SHELL:-/bin/sh}" -lc');
    expect(command).not.toContain("-lic");
    expect(command).toContain("exec 1>&3 3>&-");
    expect(command).toContain("3>&1 1>&2");
    expect(command).toContain("cd --");
    expect(command).toContain("\\''");
  });

  it("rejects values that are not SSH aliases", () => {
    expect(() =>
      sshSpawnArgs("developer@host", { command: "omp" }),
    ).toThrow("Invalid SSH host alias");
    expect(() =>
      sshSpawnArgs("-oProxyCommand=malicious", { command: "omp" }),
    ).toThrow("Invalid SSH host alias");
  });
});

describe("SSH host discovery", () => {
  it("parses the display metadata returned by ssh -G", () => {
    expect(
      parseSshExpansion(
        "macbook",
        [
          "host macbook",
          "hostname 100.64.0.5",
          "user yash",
          "port 2222",
        ].join("\n"),
      ),
    ).toEqual({
      alias: "macbook",
      hostname: "100.64.0.5",
      username: "yash",
      port: 2222,
    });
  });

  it("discovers explicit aliases while ignoring wildcard hosts", async () => {
    const home = fs.mkdtempSync(
      path.join(os.tmpdir(), "overtchat-connector-ssh-"),
    );
    temporaryPaths.push(home);
    fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".ssh", "config"),
      [
        "Host overtchat-test-host",
        "  HostName 127.0.0.1",
        "Host *.internal",
        "  User developer",
      ].join("\n"),
    );
    process.env.HOME = home;

    await expect(listSshHosts()).resolves.toEqual([
      expect.objectContaining({ alias: "overtchat-test-host" }),
    ]);
  });
});
