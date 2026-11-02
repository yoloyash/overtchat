import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NetworkState } from "expo-network";
import { useChatGenerationRecovery } from "./useChatGenerationRecovery";

const mocks = vi.hoisted(() => ({
  appState: "active",
  appListener: undefined as ((state: string) => void) | undefined,
  networkListener: undefined as ((state: NetworkState) => void) | undefined,
  networkState: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() { return mocks.appState; },
    addEventListener: (_event: string, listener: typeof mocks.appListener) => {
      mocks.appListener = listener;
      return { remove: () => { mocks.appListener = undefined; } };
    },
  },
}));
vi.mock("expo-network", () => ({
  getNetworkStateAsync: mocks.networkState,
  addNetworkStateListener: (listener: typeof mocks.networkListener) => {
    mocks.networkListener = listener;
    return { remove: () => { mocks.networkListener = undefined; } };
  },
}));
vi.mock("@/lib/api", () => ({ authFetch: mocks.fetch }));

let root: Root;
const settled = vi.fn();
const resume = vi.fn(async () => {});
const stop = vi.fn();
const props = {
  baseURL: "https://chat.example",
  chatId: "chat",
  status: "ready",
  enabled: true,
  recoverOnMount: true,
  stopLocalStream: stop,
  resumeStream: resume,
  clearError: vi.fn(),
  setMessages: vi.fn(),
  onSettled: settled,
};
function Probe(overrides: Partial<typeof props> & { suspended?: boolean }) {
  useChatGenerationRecovery({ ...props, ...overrides });
  return null;
}
function network(connected: boolean, reachable = connected): NetworkState {
  return { isConnected: connected, isInternetReachable: reachable };
}
async function emitNetwork(connected: boolean, reachable = connected) {
  await act(async () => mocks.networkListener?.(network(connected, reachable)));
}
async function emitApp(state: string) {
  await act(async () => {
    mocks.appState = state;
    mocks.appListener?.(state);
  });
}
async function mount(overrides: Partial<typeof props> & { suspended?: boolean } = {}) {
  await act(async () => root.render(<Probe {...overrides} />));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = "active";
  mocks.networkState.mockReset().mockResolvedValue(network(true));
  mocks.fetch.mockReset().mockImplementation(async () => Response.json({
    active: false, status: "completed", responseMessage: null,
  }));
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(window.document.getElementById("root") as unknown as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("recovers on mount once and ignores repeated online capability notifications", async () => {
  await mount();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(settled).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 5; i++) await emitNetwork(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(settled).toHaveBeenCalledTimes(1);
});

it("recovers once per reconnect, including restored internet reachability", async () => {
  await mount();
  await emitNetwork(false);
  await emitNetwork(true);
  await emitNetwork(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  await emitNetwork(true, false);
  await emitNetwork(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
});

it("seeds an offline baseline when there is no initial listener event", async () => {
  mocks.networkState.mockResolvedValue(network(false));
  await mount({ recoverOnMount: false });
  expect(mocks.fetch).not.toHaveBeenCalled();
  await emitNetwork(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("does not mistake unknown network state for a disconnect", async () => {
  await mount();
  await act(async () => mocks.networkListener?.({}));
  await emitNetwork(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await emitNetwork(false);
  await act(async () => mocks.networkListener?.({}));
  await emitNetwork(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("does not let a late network snapshot erase a newer offline notification", async () => {
  let finish!: (state: NetworkState) => void;
  mocks.networkState.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await mount();
  await emitNetwork(false);
  await act(async () => finish(network(true)));
  await emitNetwork(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("keeps listening if the initial snapshot fails", async () => {
  mocks.networkState.mockRejectedValue(new Error("unavailable"));
  await mount();
  await emitNetwork(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await emitNetwork(false);
  await emitNetwork(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("defers background reconnects until foreground and ignores duplicate active events", async () => {
  await mount();
  await emitApp("background");
  await emitNetwork(false);
  await emitNetwork(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await emitApp("active");
  await emitApp("active");
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("does not recover a chat mounted in the background until foreground", async () => {
  mocks.appState = "background";
  await mount();
  expect(mocks.fetch).not.toHaveBeenCalled();
  await emitApp("active");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("resumes an active server generation after a real reconnect", async () => {
  await mount();
  mocks.fetch.mockResolvedValue(Response.json({ active: true }));
  await emitNetwork(false);
  await emitNetwork(true);
  expect(resume).toHaveBeenCalledTimes(1);
  expect(settled).toHaveBeenCalledTimes(1);
  await emitNetwork(true);
  expect(resume).toHaveBeenCalledTimes(1);
});

it("removes listeners while suspended and restores mount recovery afterward", async () => {
  await mount();
  await mount({ suspended: true });
  expect(mocks.networkListener).toBeUndefined();
  expect(mocks.appListener).toBeUndefined();
  await mount();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("does not subscribe or recover while disabled", async () => {
  await mount({ enabled: false });
  expect(mocks.networkListener).toBeUndefined();
  expect(mocks.fetch).not.toHaveBeenCalled();
});
