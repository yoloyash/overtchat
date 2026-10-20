import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { WebSocket } from "ws";
import { TerminalRelay } from "../../web/lib/agents/terminal/relay";
import { TerminalChannel } from "./terminal-channel";
import { ConnectorTerminalManager } from "./terminal";
import { TERMINAL_SOCKET_PATH, TERMINAL_STREAM_PROTOCOL, type AgentDaemonWorkspaceDescriptor, type TerminalViewMessage } from "@overtchat/agent-bridge";

const workspace: AgentDaemonWorkspaceDescriptor = {
  workspaceId: "terminal-channel-test", connectionId: "connection", provider: "codex",
  executable: "codex", target: { transport: "local" }, cwd: process.cwd(),
};
const cleanups: Array<() => void | Promise<void>> = [];
beforeEach(() => { vi.stubEnv("SHELL", "/bin/sh"); });
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});
async function harness() {
  const relay = new TerminalRelay((request) => request.headers.authorization === "Bearer test-host" ? { id: "host", authorize: () => true } : null);
  await relay.start(0);
  cleanups.push(() => relay.close());
  const manager = new ConnectorTerminalManager();
  const channel = new TerminalChannel(`http://127.0.0.1:${relay.port}`, "test-host", manager);
  channel.start();
  cleanups.push(() => { channel.stop(); manager.stopAll(); });
  await expect.poll(() => relay.isOnline("host")).toBe(true);
  const grant = (authorize = async () => true) => relay.issue({ connectorId: "host", workspace, size: { cols: 80, rows: 24 }, origin: "http://app.test", authorize });
  const open = (ticket = grant(), origin = "http://app.test") => {
    const socket = new WebSocket(`ws://127.0.0.1:${relay.port}${TERMINAL_SOCKET_PATH}`, [TERMINAL_STREAM_PROTOCOL, `ticket.${ticket}`], { origin });
    cleanups.push(() => socket.terminate());
    const messages: TerminalViewMessage[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    return { socket, messages, output: () => messages.flatMap((m) => m.type === "output" ? [m.data] : m.type === "snapshot" ? [m.snapshot.data] : []).join("") };
  };
  return { relay, channel, manager, grant, open };
}

describe("workspace terminal stream", () => {
  it("runs a real PTY, delivers ordered input, and retains it across reconnects", async () => {
    const { open } = await harness();
    const first = open();
    await expect.poll(() => first.messages.some((m) => m.type === "snapshot")).toBe(true);
    first.socket.send(JSON.stringify({ type: "input", data: "export OVERTCHAT_TERMINAL_TEST=kept; printf '__%s__\\n' READY\r" }));
    await expect.poll(first.output, { timeout: 5000 }).toContain("__READY__");
    first.socket.close();
    await once(first.socket, "close");
    const second = open();
    await expect.poll(() => second.messages.some((m) => m.type === "snapshot")).toBe(true);
    second.socket.send(JSON.stringify({ type: "input", data: "printf '\\nRESULT:%s\\n' \"$OVERTCHAT_TERMINAL_TEST\"\r" }));
    await expect.poll(second.output, { timeout: 5000 }).toContain("RESULT:kept");
    const snapshots = second.messages.filter((m) => m.type === "snapshot");
    expect(snapshots).toHaveLength(1);
    let revision = snapshots[0]!.snapshot.revision;
    for (const message of second.messages) if (message.type === "output" || message.type === "exit") expect(message.revision).toBe(++revision);
  });

  it("rejects a ticket from another origin and never accepts the ticket twice", async () => {
    const { grant, open } = await harness();
    const ticket = grant();
    const wrong = open(ticket, "http://other.test");
    await expect(once(wrong.socket, "open")).rejects.toThrow("401");
    const reused = open(ticket);
    await expect(once(reused.socket, "open")).rejects.toThrow("401");
  });

  it("rechecks authorization before attaching", async () => {
    const { grant, open } = await harness();
    const denied = open(grant(async () => false));
    await expect(once(denied.socket, "open")).rejects.toThrow("401");
  });

  it("keeps concurrent viewers synchronized through restart and size ownership changes", async () => {
    const { open } = await harness();
    const a = open();
    await expect.poll(() => a.messages.some((m) => m.type === "snapshot")).toBe(true);
    const b = open();
    await expect.poll(() => b.messages.some((m) => m.type === "snapshot")).toBe(true);
    a.socket.send(JSON.stringify({ type: "resize", size: { cols: 101, rows: 31 }, claim: true }));
    b.socket.send(JSON.stringify({ type: "resize", size: { cols: 90, rows: 20 } }));
    a.socket.send(JSON.stringify({ type: "input", data: "stty size\r" }));
    await expect.poll(a.output).toContain("31 101");
    a.socket.send(JSON.stringify({ type: "restart", size: { cols: 101, rows: 31 } }));
    await expect.poll(() => a.messages.filter((m) => m.type === "snapshot").length).toBe(2);
    await expect.poll(() => b.messages.filter((m) => m.type === "snapshot").length).toBe(2);
    b.socket.send(JSON.stringify({ type: "input", data: "printf '\\nAFTER_RESTART\\n'\r" }));
    await expect.poll(a.output).toContain("\r\nAFTER_RESTART\r\n");
    await expect.poll(b.output).toContain("\r\nAFTER_RESTART\r\n");
  });

  it("streams a large burst without gaps or repeated snapshots", async () => {
    const { open } = await harness();
    const view = open();
    await expect.poll(() => view.messages.some((m) => m.type === "snapshot")).toBe(true);
    view.socket.send(JSON.stringify({ type: "input", data: "head -c 1048576 /dev/zero | tr '\\0' x; printf '\\nBURST_FINISHED\\n'\r" }));
    await expect.poll(view.output, { timeout: 15000 }).toContain("\r\nBURST_FINISHED\r\n");
    expect(view.output().length).toBeGreaterThan(1048576);
    expect(view.messages.filter((m) => m.type === "snapshot")).toHaveLength(1);
    let revision = 0;
    for (const message of view.messages) {
      if (message.type === "snapshot") revision = message.snapshot.revision;
      else if (message.type === "output" || message.type === "exit") expect(message.revision).toBe(++revision);
    }
  });
});
