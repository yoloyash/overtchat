import { WebSocket } from "ws";
import {
  TERMINAL_MAX_BUFFER_BYTES, TERMINAL_SOCKET_PATH, TERMINAL_STREAM_PROTOCOL,
  isTerminalHostMessage,
  type AgentDaemonWorkspaceDescriptor, type AgentTerminalSize, type TerminalHostMessage,
  type TerminalHostReply, type TerminalViewMessage,
} from "@overtchat/agent-bridge";
import { ConnectorTerminalManager } from "./terminal.js";

type View = { workspace: AgentDaemonWorkspaceDescriptor; size: AgentTerminalSize; tail: Promise<void> };

/** One ordered stream per view; input never waits for agent RPCs or network acknowledgements. */
export class TerminalChannel {
  private socket?: WebSocket;
  private retry?: NodeJS.Timeout;
  private stopped = true;
  private attempt = 0;
  private readonly views = new Map<string, View>();
  private pendingControlBytes = 0;
  private readonly workspaceTails = new Map<string, Promise<void>>();
  private readonly owners = new Map<string, string>();
  constructor(private readonly serverUrl: string, private readonly token: string, private readonly terminals: ConnectorTerminalManager) {}

  start(): void { if (this.stopped) { this.stopped = false; this.connect(); } }
  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.socket?.terminate();
    this.detachAll();
  }

  private connect(): void {
    if (this.stopped) return;
    const url = new URL(`${this.serverUrl}${TERMINAL_SOCKET_PATH}?role=connector`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url, TERMINAL_STREAM_PROTOCOL, {
      headers: { Authorization: `Bearer ${this.token}` },
      maxPayload: TERMINAL_MAX_BUFFER_BYTES, perMessageDeflate: false,
      handshakeTimeout: 10_000, followRedirects: false,
    });
    this.socket = socket;
    let heartbeat: NodeJS.Timeout;
    const alive = () => {
      clearTimeout(heartbeat);
      heartbeat = setTimeout(() => socket.terminate(), 45_000);
      heartbeat.unref();
    };
    socket.on("open", () => { this.attempt = 0; alive(); });
    socket.on("ping", alive);
    socket.on("message", (data, binary) => {
      if (this.stopped || this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      let message: unknown;
      try { message = JSON.parse(data.toString()); } catch { socket.close(1008, "Invalid terminal message."); return; }
      if (binary || !isTerminalHostMessage(message)) { socket.close(1008, "Invalid terminal message."); return; }
      this.accept(message);
    });
    socket.on("error", () => socket.terminate());
    socket.once("close", () => {
      clearTimeout(heartbeat);
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.detachAll();
      if (!this.stopped) {
        this.retry = setTimeout(() => this.connect(), Math.min(500 * 2 ** this.attempt++, 10_000));
        this.retry.unref();
      }
    });
  }

  private send(streamId: string, message: TerminalViewMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.views.has(streamId)) return;
    const encoded = JSON.stringify({ streamId, message } satisfies TerminalHostReply);
    if (socket.bufferedAmount + Buffer.byteLength(encoded) > TERMINAL_MAX_BUFFER_BYTES) {
      socket.close(1013, "Terminal output receiver is behind.");
      return;
    }
    socket.send(encoded, (error) => { if (error) socket.terminate(); });
  }

  private accept(message: TerminalHostMessage): void {
    const { streamId } = message;
    if (message.type === "detach") { this.detach(streamId); return; }
    if (message.type === "attach") {
      if (this.views.has(streamId) || this.views.size >= 128) return;
      const view: View = { workspace: message.workspace, size: message.size, tail: Promise.resolve() };
      this.views.set(streamId, view);
      this.owners.set(view.workspace.workspaceId, streamId);
      this.enqueue(streamId, view, () => this.snapshot(streamId, view));
      return;
    }
    const view = this.views.get(streamId);
    if (!view) return;
    const bytes = JSON.stringify(message.control).length;
    if (this.pendingControlBytes + bytes > 256 * 1024) { this.socket?.close(1013, "Terminal input is congested."); return; }
    this.pendingControlBytes += bytes;
    this.enqueue(streamId, view, async () => {
      const { control } = message;
      const workspaceId = view.workspace.workspaceId;
      switch (control.type) {
        case "input": this.terminals.write(workspaceId, control.data); break;
        case "resize":
          view.size = control.size;
          if (control.claim) this.owners.set(workspaceId, streamId);
          if (this.owners.get(workspaceId) === streamId) this.terminals.resize(workspaceId, control.size);
          break;
        case "kill": this.terminals.kill(workspaceId); break;
        case "restart": {
          // All attached views receive a new baseline before further output.
          for (const [id, other] of this.views) if (other.workspace.workspaceId === workspaceId) this.terminals.unsubscribe(id);
          await this.terminals.restart(view.workspace, control.size);
          for (const [id, other] of this.views) if (other.workspace.workspaceId === workspaceId) await this.snapshot(id, other);
          break;
        }
      }
    }, () => { this.pendingControlBytes -= bytes; });
  }

  private enqueue(streamId: string, view: View, operation: () => Promise<void>, finallyDo = () => {}): void {
    const key = view.workspace.workspaceId;
    view.tail = (this.workspaceTails.get(key) ?? Promise.resolve()).then(async () => {
      if (this.views.get(streamId) === view) await operation();
    }).catch((error: unknown) => this.send(streamId, { type: "error", message: (error instanceof Error ? error.message : String(error)).slice(0, 4096) })).finally(finallyDo);
    this.workspaceTails.set(key, view.tail);
    const tail = view.tail;
    void tail.finally(() => { if (this.workspaceTails.get(key) === tail) this.workspaceTails.delete(key); });
  }

  private async snapshot(streamId: string, view: View): Promise<void> {
    const pending: TerminalViewMessage[] = [];
    let ready = false;
    let buffered = 0;
    const owner = this.views.get(this.owners.get(view.workspace.workspaceId) ?? "");
    const snapshot = await this.terminals.subscribe(streamId, view.workspace, owner?.size ?? view.size, (event) => {
      if (ready) this.send(streamId, event);
      else {
        buffered += event.type === "output" ? Buffer.byteLength(event.data) : 128;
        if (buffered > TERMINAL_MAX_BUFFER_BYTES) this.socket?.close(1013, "Terminal snapshot is behind.");
        else pending.push(event);
      }
    });
    if (this.views.get(streamId) !== view) { this.terminals.unsubscribe(streamId); return; }
    this.send(streamId, { type: "snapshot", snapshot });
    ready = true;
    for (const event of pending) if ((event.type === "output" || event.type === "exit") && event.revision > snapshot.revision) this.send(streamId, event);
  }

  private detach(streamId: string): void {
    const view = this.views.get(streamId);
    this.views.delete(streamId);
    this.terminals.unsubscribe(streamId);
    if (view && this.owners.get(view.workspace.workspaceId) === streamId) {
      this.owners.delete(view.workspace.workspaceId);
      const fallback = [...this.views].reverse().find(([, candidate]) => candidate.workspace.workspaceId === view.workspace.workspaceId);
      if (fallback) {
        this.owners.set(view.workspace.workspaceId, fallback[0]);
        this.terminals.resize(view.workspace.workspaceId, fallback[1].size);
      }
    }
  }
  private detachAll(): void { for (const id of this.views.keys()) this.detach(id); }
}
