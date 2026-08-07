import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    spawn: mocks.spawn,
  },
}));

import { executeOnHost } from "./process";

describe("agent host process execution", () => {
  it("rejects after the command timeout even when process exit never arrives", async () => {
    vi.useFakeTimers();
    try {
      const kill = vi.fn(() => true);
      mocks.spawn.mockReturnValue({
        stdin: new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exit: new Promise(() => {}),
        kill,
      });

      const execution = executeOnHost(
        { connectorId: "connector", transport: "local" },
        { command: "omp", args: ["--version"] },
        { timeoutMs: 1_000 },
      );
      const failure = expect(execution).rejects.toThrow(
        "timed out after 1000 milliseconds",
      );

      await vi.advanceTimersByTimeAsync(1_000);

      await failure;
      expect(kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});
