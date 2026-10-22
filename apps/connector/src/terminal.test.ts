import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDaemonWorkspaceDescriptor } from "@overtchat/agent-bridge";
import { AGENT_TERMINAL_MAX_OUTPUT_CHARS } from "@overtchat/agent-bridge";
import type { Terminal } from "@xterm/headless";
import type { TerminalProcess } from "./terminal-process.js";
import {
  connectorTerminalSupport,
  ConnectorTerminalManager,
  runConnectorTerminalSmoke,
} from "./terminal.js";

const descriptor: AgentDaemonWorkspaceDescriptor = {
  connectionId: "connection",
  workspaceId: "workspace",
  provider: "codex",
  target: { transport: "local", shellMode: "login" },
  executable: "codex",
  cwd: process.cwd(),
};
beforeEach(() => { vi.stubEnv("SHELL", "/bin/sh"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("connector terminal manager", () => {
  it("runs a real local PTY in the connector workspace", async () => {
    await runConnectorTerminalSmoke();
  });

  it("reattaches with a serialized snapshot and survives unsubscribe", async () => {
    const manager = new ConnectorTerminalManager();
    const marker = `terminal-reattach-${process.pid}`;
    try {
      await manager.subscribe(
        "first",
        descriptor,
        { cols: 80, rows: 24 },
        () => {},
      );
      manager.unsubscribe("first");
      expect(
        manager.write(descriptor.workspaceId, `printf '${marker}\\n'\r`),
      ).toBe(true);
      await expect
        .poll(
          async () =>
            (
              await manager.subscribe(
                "second",
                descriptor,
                { cols: 100, rows: 30 },
                () => {},
              )
            ).data.includes(marker),
          { timeout: 5_000 },
        )
        .toBe(true);

      const snapshot = await manager.subscribe(
        "third",
        descriptor,
        { cols: 100, rows: 30 },
        () => {},
      );
      expect(snapshot.data).toContain(marker);
      expect(snapshot).toMatchObject({ cols: 100, rows: 30, exited: false });
      manager.stopWorkspace(descriptor.workspaceId);
      expect(manager.write(descriptor.workspaceId, "pwd\r")).toBe(false);
    } finally {
      manager.stopAll();
    }
  });

  it("cleans up an exited terminal after its final subscriber detaches", async () => {
    const manager = new ConnectorTerminalManager(10);
    try {
      await manager.subscribe(
        "idle",
        descriptor,
        { cols: 80, rows: 24 },
        () => {},
      );
      manager.write(descriptor.workspaceId, "exit\r");
      manager.unsubscribe("idle");

      await expect
        .poll(
          () =>
            (Reflect.get(manager, "terminals") as Map<string, unknown>).has(
              descriptor.workspaceId,
            ),
          { timeout: 1_000 },
        )
        .toBe(false);
    } finally {
      manager.stopAll();
    }
  });

  it("flushes large output bursts without dropping bytes or creating revision gaps", async () => {
    const manager = new ConnectorTerminalManager();
    const events: Array<{ revision: number }> = [];
    try {
      await manager.subscribe(
        "bounded-output",
        descriptor,
        { cols: 80, rows: 24 },
        (event) => events.push(event),
      );
      const terminals = Reflect.get(manager, "terminals") as Map<
        string,
        {
          revision: number;
          pendingOutput: string;
          outputTimer: NodeJS.Timeout | null;
          parseTail: Promise<void>;
        }
      >;
      const terminal = terminals.get(descriptor.workspaceId)!;
      const queueOutput = Reflect.get(manager, "queueOutput") as (
        terminal: unknown,
        data: string,
      ) => void;
      const flushOutputWindow = Reflect.get(
        manager,
        "flushOutputWindow",
      ) as (terminal: unknown) => void;

      queueOutput.call(manager, terminal, "seed");
      if (terminal.outputTimer) clearTimeout(terminal.outputTimer);
      const revisionBeforeOverflow = terminal.revision;
      events.splice(0);
      queueOutput.call(
        manager,
        terminal,
        "x".repeat(AGENT_TERMINAL_MAX_OUTPUT_CHARS * 3),
      );

      expect(terminal.pendingOutput.length).toBeLessThanOrEqual(
        AGENT_TERMINAL_MAX_OUTPUT_CHARS * 2,
      );
      terminal.outputTimer = null;
      flushOutputWindow.call(manager, terminal);
      await terminal.parseTail;
      expect(events[0]!.revision).toBe(revisionBeforeOverflow + 1);
    } finally {
      manager.stopAll();
    }
  });

  it("throttles a real producer when parsing falls behind without losing output or killing the shell", async () => {
    const manager = new ConnectorTerminalManager();
    let tail = "";
    let received = 0;
    let maxQueuedBytes = 0;
    let monitor: ReturnType<typeof setInterval> | undefined;
    try {
      await manager.subscribe("flow", descriptor, { cols: 80, rows: 24 }, (event) => {
        if (event.type !== "output") return;
        received += event.data.split("Q").length - 1;
        tail = (tail + event.data).slice(-1024);
      });
      manager.write(descriptor.workspaceId, "stty -echo; printf '\\nFLOW_READY\\n'\r");
      await expect.poll(() => tail, { timeout: 5_000 }).toContain("\r\nFLOW_READY\r\n");
      received = 0;
      const terminal = (Reflect.get(manager, "terminals") as Map<string, {
        emulator: Terminal; pty: TerminalProcess; parseBytes: number; exited: boolean;
      }>).get(descriptor.workspaceId)!;
      const originalWrite = terminal.emulator.write.bind(terminal.emulator);
      // A slow parser must apply pressure to the actual OS PTY, not buffer the
      // producer in JS or terminate the command when it exceeds a byte budget.
      // Completions are serialized, as a parser that takes 2 ms per write is.
      let parsed = Promise.resolve();
      vi.spyOn(terminal.emulator, "write").mockImplementation((data, callback) => {
        originalWrite(data, () => {
          parsed = parsed.then(() => new Promise((resolve) => setTimeout(resolve, 2))).then(() => callback?.());
        });
      });
      const pause = vi.spyOn(terminal.pty, "pause");
      const resume = vi.spyOn(terminal.pty, "resume");
      monitor = setInterval(() => {
        maxQueuedBytes = Math.max(maxQueuedBytes, terminal.parseBytes);
      }, 5);
      const bytes = 12 * 1024 * 1024;
      manager.write(descriptor.workspaceId, `head -c ${bytes} /dev/zero | tr '\\0' Q; printf '\\nFLOW_DONE\\n'\r`);
      await expect.poll(() => tail, { timeout: 45_000 }).toContain("\r\nFLOW_DONE\r\n");
      await expect.poll(() => terminal.parseBytes, { timeout: 10_000 }).toBe(0);
      expect(received).toBe(bytes);
      expect(pause).toHaveBeenCalled();
      expect(resume).toHaveBeenCalled();
      expect(maxQueuedBytes).toBeLessThan(2 * 1024 * 1024);
      expect(terminal.exited).toBe(false);
      manager.write(descriptor.workspaceId, "printf '\\nSTILL_ALIVE\\n'\r");
      await expect.poll(() => tail, { timeout: 5_000 }).toContain("\r\nSTILL_ALIVE\r\n");
    } finally {
      if (monitor) clearInterval(monitor);
      manager.stopAll();
      vi.restoreAllMocks();
    }
  }, 60_000);

  it("rejects terminals without affecting connector startup when disabled", async () => {
    process.env.OVERTCHAT_DISABLE_AGENT_TERMINAL = "true";
    const manager = new ConnectorTerminalManager();
    try {
      expect(connectorTerminalSupport()).toEqual({
        available: false,
        reason: "Workspace terminals are disabled on this Host Connector.",
      });
      await expect(
        manager.subscribe(
          "disabled",
          descriptor,
          { cols: 80, rows: 24 },
          () => {},
        ),
      ).rejects.toThrow("Workspace terminal unavailable");
    } finally {
      delete process.env.OVERTCHAT_DISABLE_AGENT_TERMINAL;
      manager.stopAll();
    }
  });
});
