import { describe, expect, it } from "vitest";
import type { AgentDaemonSessionDescriptor } from "@overtchat/agent-bridge";
import {
  ConnectorTerminalManager,
  runConnectorTerminalSmoke,
} from "./terminal.js";

const descriptor: AgentDaemonSessionDescriptor = {
  connectionId: "connection",
  workspaceId: "workspace",
  provider: "codex",
  target: { transport: "local", shellMode: "login" },
  executable: "codex",
  cwd: process.cwd(),
  sessionId: "terminal-test",
  providerSessionId: "provider-session",
  providerSessionPath: "/provider-session",
  launchConfig: {},
};

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
        manager.write(descriptor.sessionId, `printf '${marker}\\n'\r`),
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
      manager.stopSession(descriptor.sessionId);
      expect(manager.write(descriptor.sessionId, "pwd\r")).toBe(false);
    } finally {
      manager.stopAll();
    }
  });
});
