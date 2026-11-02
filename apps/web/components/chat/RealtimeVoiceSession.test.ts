import { act, createElement, createRef, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RealtimeVoiceSession, type RealtimeVoiceSessionHandle } from "./RealtimeVoiceSession";

const clients = vi.hoisted(() => [] as { connect: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> }[]);
vi.mock("@/lib/voice/client", () => ({ OvertChatVoiceClient: class {
  connect = vi.fn(async () => this.callbacks.onStatus("listening"));
  close = vi.fn(async () => {});
  sendMessage = vi.fn<(text: string) => Promise<void>>(async () => {});
  constructor(_grant: unknown, private callbacks: { onStatus: (status: string) => void }) { clients.push(this); }
} }));
vi.mock("@/lib/queries/chats", () => ({ fetchChatMessagesPage: vi.fn(async () => ({ messages: [] })) }));
vi.mock("@/lib/api-url", () => ({ apiUrl: (path: string) => path }));

let root: Root;
let claims: number;
let releases: number;
let held: boolean;
let delayClaim: Promise<void> | undefined;
let finishClaim: () => void;
let delayRelease: Promise<void> | undefined;
let finishRelease: () => void;
const ref = createRef<RealtimeVoiceSessionHandle>();
const props = { chatId: "existing-text-chat", projectId: null, modelConfigId: "model", modelLabel: "Model",
  webSearchEnabled: false, reasoningLevel: "default" as const, onMessages: vi.fn(), onPersisted: vi.fn(), ref };

beforeEach(() => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(window, { isSecureContext: true });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Element", window.Element);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(window.document.getElementById("root") as unknown as HTMLElement);
  clients.length = 0;
  claims = releases = 0;
  held = false;
  delayClaim = delayRelease = undefined;
  finishClaim = finishRelease = () => {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/voice/session" && init?.method === "POST") {
      claims++;
      if (held) return Response.json({ error: "This chat already has an active voice session or response." }, { status: 409 });
      held = true;
      await delayClaim;
      return Response.json({ token: "ticket", sessionId: "session", chatId: props.chatId, endpoint: "/api/voice/realtime", voice: "af_heart" });
    }
    if (init?.method === "DELETE") {
      releases++;
      await delayRelease;
      held = false;
      return new Response(null, { status: 204 });
    }
    if (url === "/api/voice/events") {
      return new Response(new ReadableStream({ start(controller) {
        init?.signal?.addEventListener("abort", () => controller.close(), { once: true });
      } }));
    }
    if (url.endsWith("/stream/status")) return Response.json({ active: false });
    throw new Error(`Unexpected URL ${url}`);
  }));
});
afterEach(async () => {
  await act(async () => { finishClaim?.(); finishRelease?.(); root.unmount(); });
  vi.unstubAllGlobals();
});

it("starts an existing chat once under the development Strict Mode effect replay", async () => {
  await act(async () => root.render(createElement(StrictMode, null, createElement(RealtimeVoiceSession, props))));
  expect(document.body.textContent).toContain("Listening");
  expect(document.body.textContent).not.toContain("could not start");
  expect(claims).toBe(1);
  expect(clients).toHaveLength(1);
  expect(clients[0].connect).toHaveBeenCalledOnce();
  expect(clients[0].close).not.toHaveBeenCalled();
});

it("releases a late grant before claiming for a replacement effect", async () => {
  delayClaim = new Promise(resolve => { finishClaim = resolve; });
  delayRelease = new Promise(resolve => { finishRelease = resolve; });
  await act(async () => root.render(createElement(RealtimeVoiceSession, props)));
  expect(claims).toBe(1);
  await act(async () => root.render(createElement(RealtimeVoiceSession, { ...props, modelConfigId: "replacement" })));
  expect(claims).toBe(1);
  await act(async () => finishClaim());
  expect(releases).toBe(1);
  expect(claims).toBe(1);
  await act(async () => finishRelease());
  expect(claims).toBe(2);
  expect(clients).toHaveLength(1);
  expect(document.body.textContent).toContain("Listening");
});

it("ending while a grant is pending does not open a microphone or leak the lease", async () => {
  delayClaim = new Promise(resolve => { finishClaim = resolve; });
  await act(async () => root.render(createElement(RealtimeVoiceSession, props)));
  let ending: Promise<void>;
  await act(async () => { ending = ref.current!.end(); });
  await act(async () => { finishClaim(); await ending; });
  expect(clients).toHaveLength(0);
  expect(releases).toBe(1);
  expect(held).toBe(false);
});

it("rejects text during startup so the composer can retain its draft", async () => {
  delayClaim = new Promise(resolve => { finishClaim = resolve; });
  await act(async () => root.render(createElement(RealtimeVoiceSession, props)));
  expect(ref.current!.sendMessage("Keep this draft")).toBe(false);
  expect(clients).toHaveLength(0);
  await act(async () => finishClaim());
  await act(async () => expect(ref.current!.sendMessage("Keep this draft")).toBe(true));
  expect(clients[0].sendMessage).toHaveBeenCalledExactlyOnceWith("Keep this draft");
});

it("shows the actionable session conflict instead of a generic startup error", async () => {
  held = true;
  await act(async () => root.render(createElement(RealtimeVoiceSession, props)));
  expect(document.body.textContent).toContain("This chat already has an active voice session or response.");
  expect(clients).toHaveLength(0);
  expect(releases).toBe(0);
  expect(ref.current!.sendMessage("Keep this after failure")).toBe(false);
});

it("shows submitted text during interruption and preserves it if acceptance fails", async () => {
  await act(async () => root.render(createElement(RealtimeVoiceSession, props)));
  let fail!: (error: Error) => void;
  clients[0].sendMessage.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  await act(async () => ref.current!.sendMessage("Change the topic"));
  expect(document.body.textContent).toContain("Change the topic");
  expect(document.body.textContent).toContain("Sending…");
  await act(async () => fail(new Error("Private transport failure")));
  expect(document.body.textContent).toContain("Change the topic");
  expect(document.body.textContent).toContain("Not confirmed sent.");
  expect(document.body.textContent).not.toContain("Private transport failure");
});
