import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scan: undefined as undefined | ((event: { data: string }) => void),
  background: undefined as undefined | ((state: string) => void),
  permission: { granted: true, canAskAgain: true },
  requestPermission: vi.fn(),
  getPermission: vi.fn(),
  openSettings: vi.fn(),
  connect: vi.fn(),
  setServer: vi.fn(),
  resetAuth: vi.fn(),
  replace: vi.fn(),
  serverUrl: null as string | null,
}));

vi.mock("expo-camera", () => ({
  useCameraPermissions: () => [
    mocks.permission,
    mocks.requestPermission,
    mocks.getPermission,
  ],
  CameraView: ({
    onBarcodeScanned,
  }: {
    onBarcodeScanned: typeof mocks.scan;
  }) => {
    mocks.scan = onBarcodeScanned;
    return <div data-camera />;
  },
}));
vi.mock("react-native", () => {
  const View = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    View,
    Text: View,
    Modal: View,
    ScrollView: View,
    KeyboardAvoidingView: View,
    Platform: { OS: "ios" },
    Keyboard: { dismiss: vi.fn() },
    StyleSheet: {
      create: (value: unknown) => value,
      absoluteFill: {},
      hairlineWidth: 1,
    },
    AppState: {
      currentState: "active",
      addEventListener: (_: string, cb: typeof mocks.background) => {
        mocks.background = cb;
        return { remove: vi.fn() };
      },
    },
    Linking: { openSettings: mocks.openSettings },
    Pressable: ({
      children,
      onPress,
      disabled,
    }: {
      children: ReactNode;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
    TextInput: ({
      value,
      onChangeText,
    }: {
      value: string;
      onChangeText: (value: string) => void;
    }) => (
      <input
        value={value}
        onInput={(e) => onChangeText(e.currentTarget.value)}
        onChange={() => {}}
      />
    ),
  };
});
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("expo-router", () => ({ router: { replace: mocks.replace } }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ colors: {}, fonts: {}, radii: {} }),
}));
vi.mock("@/lib/server-url", () => ({
  useServerUrl: () => mocks.serverUrl,
  setServerUrl: mocks.setServer,
}));
vi.mock("@/lib/auth/client", () => ({
  resetAuthClient: mocks.resetAuth,
}));

import ServerScreen from "@/app/server";

let root: Root;
let container: HTMLElement;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.serverUrl = null;
  mocks.setServer.mockImplementation((url: string) => {
    mocks.serverUrl = url;
  });
  mocks.permission = { granted: true, canAskAgain: true };
  mocks.getPermission.mockResolvedValue(mocks.permission);
  const { window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: mocks.connect,
  }))
    vi.stubGlobal(key, value);
  container = window.document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
  await act(async () => root.render(<ServerScreen />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

it("connects automatically after one scan and releases the camera", async () => {
  expect(container.querySelector("input")?.value).toBe("");
  mocks.connect.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, name: "overtchat" }),
  });
  await click("Scan QR code");
  await act(async () => {
    mocks.scan?.({ data: "http://192.168.1.20:4717/" });
    mocks.scan?.({ data: "https://wrong.example.com" });
  });
  expect(container.querySelector("input")?.value).toBe(
    "http://192.168.1.20:4717",
  );
  expect(container.querySelector("[data-camera]")).toBeNull();
  expect(mocks.connect).toHaveBeenCalledOnce();
  expect(mocks.connect).toHaveBeenCalledWith(
    "http://192.168.1.20:4717/api/ping",
    expect.objectContaining({ credentials: "omit" }),
  );
  expect(mocks.setServer).toHaveBeenCalledWith("http://192.168.1.20:4717");
  expect(mocks.resetAuth).toHaveBeenCalledOnce();
  expect(mocks.replace).toHaveBeenCalledWith("/login");
});

it("rejects a store code and allows retry, then cancellation without changing the address", async () => {
  await click("Scan QR code");
  await act(async () =>
    mocks.scan?.({
      data: "https://apps.apple.com/us/app/overtchat/id6812165221",
    }),
  );
  expect(container.textContent).toContain("That code isn’t a server address");
  await click("Try again");
  expect(container.querySelector("[data-camera]")).not.toBeNull();
  await click("Cancel");
  expect(container.querySelector("input")?.value).toBe("");
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("offers device settings when camera access is denied permanently", async () => {
  mocks.permission = { granted: false, canAskAgain: false };
  mocks.openSettings.mockResolvedValue(undefined);
  await click("Scan QR code");
  expect(container.querySelector("[data-camera]")).toBeNull();
  await click("Open settings");
  expect(mocks.openSettings).toHaveBeenCalledOnce();
  await click("Cancel");
  expect(container.querySelector("input")).not.toBeNull();
});

it("unmounts the camera in the background and refreshes permission on return", async () => {
  await click("Scan QR code");
  await act(async () => mocks.background?.("background"));
  expect(container.querySelector("[data-camera]")).toBeNull();
  await act(async () => mocks.background?.("active"));
  expect(mocks.getPermission).toHaveBeenCalledOnce();
  expect(container.querySelector("[data-camera]")).not.toBeNull();
});

it("keeps an unreachable scanned address available for editing or retry", async () => {
  mocks.connect.mockRejectedValueOnce(new Error("Network request failed"));
  await click("Scan QR code");
  await act(async () => mocks.scan?.({ data: "http://192.168.1.20:4717" }));
  expect(container.querySelector("input")?.value).toBe(
    "http://192.168.1.20:4717",
  );
  expect(container.textContent).toContain("Couldn’t reach this server");
  expect(mocks.setServer).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
  mocks.connect.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ ok: true, name: "overtchat" }),
  });
  await click("Retry");
  expect(mocks.replace).toHaveBeenCalledWith("/login");
});

it("rejects a reachable address that is not an OvertChat server", async () => {
  mocks.connect.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ ok: true, name: "other" }),
  });
  await click("Scan QR code");
  await act(async () => mocks.scan?.({ data: "https://example.com" }));
  expect(container.textContent).toContain(
    "doesn't look like an overtchat server",
  );
  expect(mocks.setServer).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("times out an unresponsive server and lets the user retry", async () => {
  vi.useFakeTimers();
  mocks.connect.mockImplementationOnce((_url, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Aborted")));
  }));
  await click("Scan QR code");
  await act(async () => mocks.scan?.({ data: "https://chat.example.com" }));
  expect(container.textContent).toContain("Connecting…");
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(container.textContent).toContain("Couldn’t reach this server");
  expect(container.textContent).toContain("Retry");
  expect(mocks.setServer).not.toHaveBeenCalled();
});

it.each(["response", "body"])(
  "cancels on exit and ignores a late %s",
  async (stage) => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => { resolve = done; });
    const body = { ok: true, name: "overtchat" };
    const response = {
      ok: true,
      json: () => stage === "body" ? pending : Promise.resolve(body),
    };
    mocks.connect.mockReturnValueOnce(
      stage === "response" ? pending : Promise.resolve(response),
    );
    await click("Scan QR code");
    await act(async () => mocks.scan?.({ data: "https://chat.example.com" }));
    const signal = mocks.connect.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await act(async () => root.render(<div>Previous screen</div>));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(stage === "response" ? response : body));
    expect(mocks.setServer).not.toHaveBeenCalled();
    expect(mocks.resetAuth).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  },
);
