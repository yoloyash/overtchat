import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDaemonWorkspaceDescriptor } from "@overtchat/agent-bridge";
import { AGENT_TERMINAL_MAX_OUTPUT_CHARS } from "@overtchat/agent-bridge";
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
