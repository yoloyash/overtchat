import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  TERMINAL_MAX_BUFFER_BYTES, TERMINAL_STREAM_PROTOCOL, TERMINAL_SOCKET_PATH,
  isTerminalControl, isTerminalHostReply,
  type AgentDaemonWorkspaceDescriptor, type AgentTerminalSize, type TerminalHostMessage,
} from "@overtchat/agent-bridge";

type Grant = {
  connectorId: string;
  workspace: AgentDaemonWorkspaceDescriptor;
  size: AgentTerminalSize;
  origin: string;
  authorize: () => Promise<boolean>;
};
type Viewer = Grant & { socket: WebSocket; host: WebSocket };
type HostIdentity = { id: string; authorize: () => boolean };

/** Process-local, ephemeral terminal delivery. Shells and their state remain on the connector. */
export class TerminalRelay {
  private readonly hosts = new Map<string, WebSocket>();
  private readonly views = new Map<string, Viewer>();
  private readonly grants = new Map<string, Grant & { expires: number }>();
  private readonly sockets = new WebSocketServer({
    noServer: true, maxPayload: TERMINAL_MAX_BUFFER_BYTES, perMessageDeflate: false,
    handleProtocols: (protocols) => protocols.has(TERMINAL_STREAM_PROTOCOL) ? TERMINAL_STREAM_PROTOCOL : false,
  });
  private server?: Server;
  private starting?: Promise<void>;

  constructor(private readonly authenticateHost: (request: IncomingMessage) => HostIdentity | null) {}

  isOnline(connectorId: string): boolean {
    return this.hosts.get(connectorId)?.readyState === WebSocket.OPEN;
  }

  issue(grant: Grant): string {
    for (const [key, value] of this.grants) if (value.expires <= Date.now()) this.grants.delete(key);
    if (!this.isOnline(grant.connectorId)) throw new Error("The Host Connector terminal channel is offline.");
    if (this.grants.size >= 2048) throw new Error("Too many pending terminal attachments.");
    const ticket = randomBytes(32).toString("base64url");
    this.grants.set(ticket, { ...grant, expires: Date.now() + 30_000 });
    return ticket;
  }

  start(port: number): Promise<void> {
    return this.starting ??= new Promise((resolve, reject) => {
      this.server = createServer((_request, response) => { response.writeHead(404).end(); });
      this.server.on("upgrade", (request, socket, head) => {
        void this.upgrade(request, (connected) => {
          if (socket.destroyed) return;
          this.sockets.handleUpgrade(request, socket, head, connected);
        }).catch(() => socket.destroy()).then((accepted) => {
          if (!accepted && !socket.destroyed) socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        });
      });
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => {
        this.server!.removeListener("error", reject);
        this.server!.on("error", (error) => console.error("[terminal-relay]", error.message));
        resolve();
      });
    });
  }

  get port(): number | undefined {
    const address = this.server?.address();
    return address && typeof address !== "string" ? address.port : undefined;
  }

  async close(): Promise<void> {
    this.grants.clear();
    for (const socket of this.sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => this.sockets.close(() => resolve()));
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  private send(socket: WebSocket, value: unknown): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;
    const data = JSON.stringify(value);
    if (socket.bufferedAmount + Buffer.byteLength(data) > TERMINAL_MAX_BUFFER_BYTES) {
      socket.close(1013, "Terminal receiver is behind; reconnect to restore output.");
      return false;
    }
    socket.send(data, (error) => { if (error) socket.terminate(); });
    return true;
  }

  private watch(socket: WebSocket, authorize: () => boolean | Promise<boolean>): void {
    let alive = true;
    let checking = false;
    socket.on("pong", () => { alive = true; });
    socket.on("error", () => socket.terminate());
    const timer = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false;
      socket.ping();
      if (checking) return;
      checking = true;
      void Promise.resolve().then(authorize).then((allowed) => {
        if (!allowed) socket.close(1008, "Terminal access expired.");
      }, () => socket.close(1008, "Terminal access could not be verified.")).finally(() => { checking = false; });
    }, 15_000);
    timer.unref();
    socket.once("close", () => clearInterval(timer));
  }

  private async upgrade(request: IncomingMessage, accept: (connected: (socket: WebSocket) => void) => void): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const protocols = (request.headers["sec-websocket-protocol"] ?? "").split(",").map((part) => part.trim());
    if (url.pathname !== TERMINAL_SOCKET_PATH || !protocols.includes(TERMINAL_STREAM_PROTOCOL)) return false;
    if (url.searchParams.get("role") === "connector") {
      const identity = this.authenticateHost(request);
      if (!identity) return false;
      accept((socket) => this.attachHost(identity, socket));
      return true;
    }
    const ticket = protocols.find((protocol) => protocol.startsWith("ticket."))?.slice(7);
    const grant = ticket ? this.grants.get(ticket) : undefined;
    if (ticket) this.grants.delete(ticket);
    if (!grant || grant.expires <= Date.now() || request.headers.origin !== grant.origin || !(await grant.authorize())) return false;
    const host = this.hosts.get(grant.connectorId);
    if (!host || host.readyState !== WebSocket.OPEN) return false;
    if ([...this.views.values()].filter((view) => view.connectorId === grant.connectorId).length >= 128) return false;
    accept((socket) => {
      const streamId = randomUUID();
      this.views.set(streamId, { ...grant, socket, host });
      this.watch(socket, grant.authorize);
      socket.on("message", (data, binary) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (this.hosts.get(grant.connectorId) !== host) {
          socket.close(1012, "Host Connector connection replaced.");
          return;
        }
        let control: unknown;
        try { control = JSON.parse(data.toString()); } catch { socket.close(1008, "Invalid terminal control."); return; }
        if (binary || !isTerminalControl(control)) { socket.close(1008, "Invalid terminal control."); return; }
        this.send(host, { type: "control", streamId, control } satisfies TerminalHostMessage);
      });
      socket.once("close", () => {
        this.views.delete(streamId);
        this.send(host, { type: "detach", streamId } satisfies TerminalHostMessage);
      });
      if (!this.send(host, { type: "attach", streamId, workspace: grant.workspace, size: grant.size } satisfies TerminalHostMessage)) socket.close(1013, "Host Connector disconnected.");
    });
    return true;
  }

  private attachHost(identity: HostIdentity, socket: WebSocket): void {
    this.hosts.get(identity.id)?.close(1012, "Connector connection replaced.");
    this.hosts.set(identity.id, socket);
    this.watch(socket, identity.authorize);
    socket.on("message", (data, binary) => {
      if (socket.readyState !== WebSocket.OPEN || this.hosts.get(identity.id) !== socket) return;
      let reply: unknown;
      try { reply = JSON.parse(data.toString()); } catch { socket.close(1008, "Invalid terminal reply."); return; }
      if (binary || !isTerminalHostReply(reply)) { socket.close(1008, "Invalid terminal reply."); return; }
      const view = this.views.get(reply.streamId);
      if (view?.host === socket) this.send(view.socket, reply.message);
    });
    socket.once("close", () => {
      if (this.hosts.get(identity.id) === socket) this.hosts.delete(identity.id);
      for (const view of this.views.values()) if (view.host === socket) view.socket.close(1012, "Host Connector disconnected.");
    });
  }
}
