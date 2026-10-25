import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { WebSocket } from "ws";
import { TERMINAL_MAX_BUFFER_BYTES, TERMINAL_SOCKET_PATH, TERMINAL_STREAM_PROTOCOL, type AgentDaemonWorkspaceDescriptor } from "@overtchat/agent-bridge";
import { TerminalRelay } from "./relay";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const workspace: AgentDaemonWorkspaceDescriptor = {
  workspaceId: "workspace", connectionId: "connection", cwd: "/tmp",
  provider: "codex", executable: "codex", target: { transport: "local" },
};
async function harness() {
  const relay = new TerminalRelay((request) => {
    const id = request.headers.authorization;
    return id === "host-a" || id === "host-b" ? { id, authorize: () => true } : null;
  });
  await relay.start(0);
  cleanups.push(() => relay.close());
  const url = `ws://127.0.0.1:${relay.port}${TERMINAL_SOCKET_PATH}`;
  const host = async (id: string) => {
    const socket = new WebSocket(`${url}?role=connector`, TERMINAL_STREAM_PROTOCOL, { headers: { Authorization: id } });
    cleanups.push(() => socket.terminate());
    await once(socket, "open");
    return socket;
  };
  const grant = () => relay.issue({ connectorId: "host-a", workspace, size: { cols: 80, rows: 24 }, origin: "https://app.test", authorize: async () => true });
  const viewer = (ticket = grant()) => {
    const socket = new WebSocket(url, [TERMINAL_STREAM_PROTOCOL, `ticket.${ticket}`], { origin: "https://app.test" });
    cleanups.push(() => socket.terminate());
    return socket;
  };
  return { host, viewer, grant, relay, url };
}

describe("terminal relay isolation", () => {
  it("rejects missing host credentials and expired tickets", async () => {
    const { host, viewer, grant, url } = await harness();
    const invalid = new WebSocket(`${url}?role=connector`, TERMINAL_STREAM_PROTOCOL);
    await expect(once(invalid, "open")).rejects.toThrow("401");
    await host("host-a");
    const ticket = grant();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    await expect(once(viewer(ticket), "open")).rejects.toThrow("401");
  });
  it("routes output only from the host that owns the viewer and closes malformed controls", async () => {
    const { host, viewer } = await harness();
    const owner = await host("host-a");
    const other = await host("host-b");
    const attached = once(owner, "message");
    const view = viewer();
    const received: unknown[] = [];
    view.on("message", (data) => received.push(JSON.parse(data.toString())));
    await once(view, "open");
    const attach = JSON.parse((await attached)[0].toString());
    other.send(JSON.stringify({ streamId: attach.streamId, message: { type: "output", revision: 1, data: "cross-host" } }));
    const rejected = once(other, "close");
    other.send("invalid reply");
    expect((await rejected)[0]).toBe(1008);
    const correct = once(view, "message");
    owner.send(JSON.stringify({ streamId: attach.streamId, message: { type: "output", revision: 1, data: "owned" } }));
    await correct;
    expect(received).toEqual([{ type: "output", revision: 1, data: "owned" }]);
    const closed = once(view, "close");
    view.send(JSON.stringify({ type: "resize", size: { cols: -1, rows: 24 } }));
    expect((await closed)[0]).toBe(1008);
  });
  it("disconnects old viewers when the connector connection is replaced", async () => {
    const { host, viewer } = await harness();
    await host("host-a");
    const view = viewer();
    await once(view, "open");
    const closed = once(view, "close");
    await host("host-a");
    expect((await closed)[0]).toBe(1012);
  });
  it("ignores queued input as soon as access is closed, before the close handshake finishes", async () => {
    const { host, viewer, relay } = await harness();
    const owner = await host("host-a");
    const attached = once(owner, "message");
    const view = viewer();
    await once(view, "open");
    const { streamId } = JSON.parse((await attached)[0].toString());
    const serverView = (Reflect.get(relay, "views") as Map<string, { socket: WebSocket; host: WebSocket }>).get(streamId)!;
    const send = vi.spyOn(serverView.host, "send");
    const closed = once(view, "close");
    serverView.socket.close(1008, "Terminal access expired.");
    serverView.socket.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "queued command\r" })), false);
    expect(send).not.toHaveBeenCalled();
    expect((await closed)[0]).toBe(1008);
  });
  it("disconnects a viewer before output and frame headers would exceed the buffer cap", async () => {
    const { host, viewer, relay } = await harness();
    const owner = await host("host-a");
    const attached = once(owner, "message");
    const view = viewer();
    await once(view, "open");
    const { streamId } = JSON.parse((await attached)[0].toString());
    const serverView = (Reflect.get(relay, "views") as Map<string, { socket: WebSocket }>).get(streamId)!;
    const output = { type: "output", revision: 1, data: "x" };
    // The payload alone fits exactly; its frame header would not.
    Object.defineProperty(serverView.socket, "bufferedAmount", {
      configurable: true,
      get: () => TERMINAL_MAX_BUFFER_BYTES - Buffer.byteLength(JSON.stringify(output)),
    });
    const outcome = Promise.race([
      once(view, "message").then(() => "delivered"),
      once(view, "close").then(([code]) => code),
    ]);
    owner.send(JSON.stringify({ streamId, message: output }));
    expect(await outcome).toBe(1013);
  });
});
