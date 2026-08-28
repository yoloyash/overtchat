import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { configureProcessSpawner } from "../runtime/process";
import { spawnClaudeOnHost } from "./process";

describe("Claude host process", () => {
  it("keeps target auth local and forwards lifecycle events", async () => {
    const launches: Array<Record<string, unknown>> = [];
    let finish!: (value: { code: number; signal: null }) => void;
    configureProcessSpawner((_target, launch) => {
      launches.push(launch);
      return {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exit: new Promise((resolve) => {
          finish = resolve;
        }),
        kill: vi.fn(() => true),
      };
    });
    const controller = new AbortController();
    const process = spawnClaudeOnHost(
      { transport: "ssh", alias: "workstation" },
      {
        command: "/usr/bin/claude",
        args: ["--output-format", "stream-json"],
        cwd: "/workspace",
        env: {
          ANTHROPIC_API_KEY: "must-not-cross-ssh",
          CLAUDE_AGENT_SDK_CLIENT_APP: "overtchat/test",
        },
        signal: controller.signal,
      },
      vi.fn(),
    );
    expect(launches[0]).toMatchObject({
      command: "/usr/bin/claude",
      cwd: "/workspace",
      env: { CLAUDE_AGENT_SDK_CLIENT_APP: "overtchat/test" },
    });
    const env = Reflect.get(launches[0]!, "env") as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();

    const exited = new Promise((resolve) => process.once("exit", resolve));
    finish({ code: 0, signal: null });
    await exited;
    expect(process.exitCode).toBe(0);
  });
});
