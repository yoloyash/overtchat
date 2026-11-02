import { OvertChatVoiceClient, type VoiceClientCallbacks, type VoiceClientStatus } from "@overtchat/voice-client";
import type { ChatReasoningLevel, VoiceSessionGrant } from "@overtchat/shared";
import type { UIMessage } from "ai";

export type VoiceState = {
  status: VoiceClientStatus | "idle" | "ending";
  muted: boolean;
  error: string | null;
  warning: string | null;
  inputLevel: number;
  outputLevel: number;
  pendingText: string | null;
  cleanupPending: boolean;
};
export type VoiceOptions = {
  chatId: string;
  projectId: string | null;
  modelConfigId: string;
  webSearchEnabled: boolean;
  reasoningLevel: ChatReasoningLevel;
  timeZone: string;
};
type Client = Pick<OvertChatVoiceClient, "connect" | "close" | "setMuted" | "sendMessage" | "setActiveTurn" | "interrupt">;
export type VoiceDependencies = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  createClient: (grant: VoiceSessionGrant, callbacks: VoiceClientCallbacks) => Client;
  onMessage: (message: UIMessage) => void;
  onRefresh: (messages: UIMessage[]) => void;
  onPersisted: () => void;
};
const initial: VoiceState = { status: "idle", muted: false, error: null, warning: null, inputLevel: 0, outputLevel: 0, pendingText: null, cleanupPending: false };
const endingError = "Could not finish ending voice. Check your connection and tap End again.";

/** One explicit foreground call. Closing also fences late grants, audio, and history reads. */
export class MobileVoiceSession {
  private state: VoiceState = initial;
  private listeners = new Set<() => void>();
  private grant: VoiceSessionGrant | null = null;
  private client: Client | null = null;
  private events: AbortController | null = null;
  private starting: Promise<void> = Promise.resolve();
  private ending: Promise<void> | null = null;
  private stopped = true;
  private disposed = false;
  private pendingSend = false;
  private heartbeat: ReturnType<typeof setTimeout> | undefined;
  private releasePromise: Promise<void> | null = null;
  constructor(private readonly deps: VoiceDependencies) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(change: Partial<VoiceState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  private active = () => !this.stopped && !this.disposed;

  start(options: VoiceOptions): Promise<void> {
    if (this.disposed || this.state.status !== "idle" || this.ending) return Promise.resolve();
    this.stopped = false;
    this.releasePromise = null;
    this.patch({ ...initial, status: "connecting" });
    this.starting = this.connect(options).catch(async () => {
      if (!this.active()) return;
      if (!this.state.error) this.patch({ error: "Could not start voice. Check your connection and voice services, then try again." });
      // Do not await end here: it waits for this startup operation to release late grants.
      void this.end().catch(() => {});
    });
    return this.starting;
  }

  private async connect(options: VoiceOptions) {
    const response = await this.deps.request("/api/voice/session", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options),
    });
    if (!response.ok) {
      if (this.active()) this.patch({ error: response.status === 409
        ? "This chat already has an active response or voice call. Finish it before starting voice."
        : "Could not start voice. Check your connection and voice services, then try again." });
      throw new Error("Voice session unavailable");
    }
    const grant = await response.json() as VoiceSessionGrant;
    if (!grant.token || !grant.sessionId || grant.chatId !== options.chatId || grant.endpoint !== "/api/voice/realtime") {
      throw new Error("Invalid voice session");
    }
    this.grant = grant;
    if (!this.active()) return;
    this.events = new AbortController();
    const stream = await this.deps.request("/api/voice/events", {
      headers: { "X-OvertChat-Voice-Ticket": grant.token }, signal: this.events.signal,
    });
    if (!this.active()) { await stream.body?.cancel(); return; }
    if (!stream.ok || !stream.body) throw new Error("Voice history unavailable");
    const currentCall = () => this.active() && this.grant === grant;
    const callbacks: VoiceClientCallbacks = {
      onStatus: status => { if (currentCall() && status !== "closed") this.patch({ status }); },
      onInputLevel: inputLevel => { if (currentCall()) this.patch({ inputLevel }); },
      onOutputLevel: outputLevel => { if (currentCall()) this.patch({ outputLevel }); },
      onWarning: warning => { if (currentCall()) this.patch({ warning }); },
      onError: () => { if (currentCall()) this.fail("Voice disconnected or audio was interrupted. Start voice again when ready."); },
    };
    this.client = this.deps.createClient(grant, callbacks);
    void this.readEvents(stream.body, this.events.signal);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.client.connect(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Voice connection timed out")), 30_000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    if (!this.active()) await this.client?.close();
  }

  private fail(message: string) {
    if (!this.active()) return;
    this.patch({ error: message });
    void this.end().catch(() => {});
  }
  private async readEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    try {
      while (this.active() && !signal.aborted) {
        clearTimeout(heartbeat);
        heartbeat = setTimeout(() => {
          if (!signal.aborted) this.fail("Voice lost its connection. Start voice again when you are connected.");
        }, 45_000);
        this.heartbeat = heartbeat;
        const { value, done } = await reader.read();
        if (!this.active() || signal.aborted) break;
        if (done) throw new Error("Voice stream ended");
        pending += decoder.decode(value, { stream: true });
        if (pending.length > 2_000_000) throw new Error("Voice event too large");
        let boundary: number;
        while (this.active() && !signal.aborted && (boundary = pending.indexOf("\n\n")) !== -1) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          if (!frame.startsWith("data: ")) continue;
          const event = JSON.parse(frame.slice(6));
          if (event.type === "message") {
            this.deps.onMessage(event.message);
            if (event.message.role === "user") {
              this.client?.setActiveTurn(event.message.id);
              this.deps.onPersisted();
            }
          } else if (event.type === "settled") {
            this.client?.setActiveTurn(null);
            // Keep updates in stream order; an older refresh must not erase a newer turn.
            await this.refresh(true);
          } else if (event.type === "error") {
            this.patch({ warning: "The voice response failed. Please try speaking again." });
          }
        }
      }
    } catch {
      if (!signal.aborted) this.fail("Voice lost its connection. Start voice again when you are connected.");
    } finally {
      clearTimeout(heartbeat);
      if (this.heartbeat === heartbeat) this.heartbeat = undefined;
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  private async refresh(activeOnly = false) {
    if (!this.grant) return;
    const grant = this.grant;
    const response = await this.deps.request(`/api/chat/${encodeURIComponent(this.grant.chatId)}/messages?openui=1`);
    if (response.status === 404) return; // A call ended without a spoken turn.
    if (!response.ok) throw new Error("Could not refresh conversation");
    const body = await response.json();
    if (!this.disposed && this.grant === grant && (!activeOnly || this.active())) {
      this.deps.onRefresh(body.messages);
      this.deps.onPersisted();
    }
  }
  private release(): Promise<void> {
    if (!this.grant) return Promise.resolve();
    return this.releasePromise ??= this.deps.request("/api/voice/session", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: this.grant.sessionId }),
    }).then(response => {
      if (!response.ok) throw new Error("Could not end voice");
    }).catch(error => { this.releasePromise = null; throw error; });
  }
  end = (): Promise<void> => {
    if (this.ending) return this.ending;
    if (this.state.status === "idle") return Promise.resolve();
    this.stopped = true;
    clearTimeout(this.heartbeat);
    this.events?.abort();
    // Close native devices immediately, before awaiting network or pending startup.
    const closing = this.client?.close();
    this.patch({ status: "ending", muted: false, inputLevel: 0, outputLevel: 0, pendingText: null, cleanupPending: true });
    this.ending = (async () => {
      await closing;
      await this.starting;
      await this.client?.close();
      await this.release();
      if (this.grant) {
        const deadline = Date.now() + 15_000;
        while (true) {
          const response = await this.deps.request(`/api/chat/${encodeURIComponent(this.grant.chatId)}/stream/status`);
          if (response.status === 404) break;
          if (!response.ok) throw new Error("Could not settle voice");
          if (!(await response.json()).active) break;
          if (Date.now() >= deadline) throw new Error("Voice is still stopping");
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        await this.refresh();
      }
      this.client = null;
      this.grant = null;
      this.patch({ status: "idle", error: this.state.error === endingError ? null : this.state.error, warning: null, pendingText: null });
    })().catch(error => {
      this.patch({ error: endingError });
      throw error;
    }).finally(() => {
      this.ending = null;
      this.patch({ cleanupPending: false });
    });
    return this.ending;
  };
  toggleMute = () => {
    if (!this.active() || this.state.status === "connecting") return;
    const muted = !this.state.muted;
    this.client?.setMuted(muted);
    this.patch({ muted });
  };
  interrupt = () => { if (this.active()) this.client?.interrupt(); };
  async sendMessage(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!this.active() || !this.client || this.state.status === "connecting" || this.pendingSend || !trimmed) return false;
    this.pendingSend = true;
    this.patch({ pendingText: trimmed, warning: null });
    try {
      await this.client.sendMessage(text);
      if (this.active()) this.patch({ pendingText: null });
      return true;
    } catch {
      if (this.active()) this.patch({ pendingText: null, warning: "Your message was not confirmed. Check the conversation before trying again." });
      return false;
    } finally { this.pendingSend = false; }
  }
  dismissError = () => this.patch({ error: null });
  dismissWarning = () => this.patch({ warning: null });
  dispose() {
    this.disposed = true;
    void this.end().catch(() => {});
  }
}
