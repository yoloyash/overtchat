import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appState: { currentState: "active", addEventListener: vi.fn() },
  platform: { OS: "android" },
  permission: vi.fn(async () => false),
  foreground: vi.fn(async (_requested: boolean) => {}),
  start: vi.fn(async () => {}), end: vi.fn(async () => {}),
}));
vi.mock("react-native", () => ({ AppState: mocks.appState, Platform: mocks.platform }));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return { useFocusEffect: (effect: () => (() => void)) => useEffect(effect, [effect]) };
});
vi.mock("@/lib/api", () => ({ getApiBase: () => "http://test", authFetch: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({ getAuthClient: () => ({}) }));
vi.mock("@overtchat/voice-client", () => ({ OvertChatVoiceClient: class {} }));
vi.mock("./audio", () => ({
  NativeVoiceAudio: class {}, nativeVoiceAvailable: true,
  requestVoicePermission: mocks.permission, waitForVoiceForeground: mocks.foreground,
}));
vi.mock("./session", () => ({
  MobileVoiceSession: class {
    getSnapshot = () => ({ status: "idle", muted: false, error: null, warning: null,
      inputLevel: 0, outputLevel: 0, pendingText: null, cleanupPending: false });
    subscribe = () => () => {};
    start = mocks.start;
    end = mocks.end;
    dispose = () => {};
  },
}));
import { useMobileVoice, type MobileVoiceController } from "./useMobileVoice";

let root: Root;
let voice: MobileVoiceController;
let change: (state: string) => void;
const config = { chatId: "chat", projectId: null, modelConfigId: "model", webSearchEnabled: false,
  reasoningLevel: "default" as const, timeZone: "UTC" };
function Harness() {
  voice = useMobileVoice({ chatId: "chat", onMessage: () => {}, onRefresh: () => {}, onPersisted: () => {} });
  return null;
}
function appState(state: string) { mocks.appState.currentState = state; change(state); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.appState.currentState = "active";
  mocks.platform.OS = "android";
  mocks.appState.addEventListener.mockImplementation((_event, listener) => {
    change = listener;
    return { remove: vi.fn() };
  });
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(window.document.getElementById("root") as unknown as HTMLElement);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("starts after Android's permission activity temporarily backgrounds the app", async () => {
  const permission = deferred<boolean>();
  mocks.permission.mockReturnValueOnce(permission.promise);
  let starting!: Promise<void>;
  await act(async () => { starting = voice.start(config); });
  await act(async () => { appState("background"); appState("active"); permission.resolve(true); await starting; });
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.foreground).toHaveBeenCalledWith(true);
});

it("shows permission denial even when the dialog backgrounded the app", async () => {
  mocks.permission.mockImplementationOnce(async () => {
    appState("background"); appState("active");
    throw new Error("Allow microphone access");
  });
  await act(async () => { await voice.start(config); });
  expect(voice.error).toBe("Allow microphone access");
  expect(voice.busy).toBe(false);
  expect(mocks.start).not.toHaveBeenCalled();
});

it("does not start after End while permission is pending", async () => {
  const permission = deferred<boolean>();
  mocks.permission.mockReturnValueOnce(permission.promise);
  let starting!: Promise<void>;
  await act(async () => { starting = voice.start(config); });
  await act(async () => { await voice.end(); permission.resolve(true); await starting; });
  expect(mocks.start).not.toHaveBeenCalled();
});

it("does not start after navigating away while permission is pending", async () => {
  const permission = deferred<boolean>();
  mocks.permission.mockReturnValueOnce(permission.promise);
  let starting!: Promise<void>;
  await act(async () => { starting = voice.start(config); });
  await act(async () => { root.render(null); });
  permission.resolve(true);
  await starting;
  expect(mocks.start).not.toHaveBeenCalled();
});

it("ends an established call on background and does not restart on return", async () => {
  await act(async () => { await voice.start(config); });
  mocks.end.mockClear();
  await act(async () => { appState("background"); appState("active"); });
  expect(mocks.end).toHaveBeenCalledOnce();
  expect(mocks.start).toHaveBeenCalledOnce();
});

it("still cancels a real iOS background transition during permission", async () => {
  mocks.platform.OS = "ios";
  const permission = deferred<boolean>();
  mocks.permission.mockReturnValueOnce(permission.promise);
  let starting!: Promise<void>;
  await act(async () => { starting = voice.start(config); });
  await act(async () => { appState("background"); appState("active"); permission.resolve(true); await starting; });
  expect(mocks.start).not.toHaveBeenCalled();
});
