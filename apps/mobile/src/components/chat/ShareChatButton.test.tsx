import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  share: vi.fn(),
  open: vi.fn(),
  server: "https://chat.example.test",
}));
vi.mock("@/lib/api", () => ({
  authFetch: mocks.fetch,
  getApiBase: () => mocks.server,
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
vi.mock("@/lib/theme", () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock("@/lib/useSpeech", () => ({ useSpeech: () => ({}) }));
vi.mock("./MessageBubble", () => ({
  MessageBubble: ({
    message,
    readOnly,
  }: {
    message: { id: string };
    readOnly: boolean;
  }) => <div data-readonly={String(readOnly)}>{message.id}</div>,
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("react-native", () => {
  const View = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    View,
    Text: View,
    ActivityIndicator: () => <div>Loading</div>,
    Modal: ({
      visible,
      children,
    }: {
      visible: boolean;
      children: ReactNode;
    }) => (visible ? <div>{children}</div> : null),
    FlatList: ({
      data,
      renderItem,
    }: {
      data: { id: string }[];
      renderItem: (props: { item: { id: string } }) => ReactNode;
    }) => (
      <div>
        {data.map((item) => (
          <div key={item.id}>{renderItem({ item })}</div>
        ))}
      </div>
    ),
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      children: ReactNode;
      onPress: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => (
      <button
        aria-label={accessibilityLabel}
        disabled={disabled}
        onClick={onPress}
      >
        {children}
      </button>
    ),
    StyleSheet: { create: (value: unknown) => value },
    Share: { share: mocks.share },
    Linking: { openURL: mocks.open },
  };
});

import { ShareChatButton } from "./ShareChatButton";

let root: Root;
let container: HTMLElement;
let qc: QueryClient;
let shared: { id: string; url?: string } | null;
const writes: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.server = "https://chat.example.test";
  mocks.share.mockResolvedValue({});
  mocks.open.mockResolvedValue(undefined);
  shared = null;
  writes.length = 0;
  mocks.fetch.mockImplementation(
    async (url: string, init?: { method: string }) => {
      if (url.endsWith("/preview"))
        return Response.json({
          title: "Chat",
          messages: [
            {
              id: "preview-message",
              role: "user",
              parts: [{ type: "text", text: "Hello" }],
            },
          ],
        });
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        writes.push(method);
        shared = method === "DELETE" ? null : { id: "share-token" };
      }
      return Response.json({ share: shared });
    },
  );
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
  }))
    vi.stubGlobal(key, value);
  container = window.document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  vi.unstubAllGlobals();
});

function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) =>
      node.getAttribute("aria-label") === label || node.textContent === label,
  )!;
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}
async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}
async function render(disabled = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <ShareChatButton chatId="chat/id" disabled={disabled} />
      </QueryClientProvider>,
    ),
  );
}

it("previews without publishing, creates and shares the selected server URL, updates and revokes", async () => {
  await render();
  await click("Share chat");
  expect(writes).toEqual([]);
  await click("Preview current conversation");
  expect(container.querySelector('[data-readonly="true"]')?.textContent).toBe(
    "preview-message",
  );
  await click("Create link");
  expect(writes).toEqual(["POST"]);
  await click("Share link");
  expect(mocks.share).toHaveBeenCalledWith({
    message: "https://chat.example.test/share/share-token",
    url: "https://chat.example.test/share/share-token",
  });
  await click("View shared chat");
  expect(mocks.open).toHaveBeenCalledWith(
    "https://chat.example.test/share/share-token",
  );
  await click("Update link");
  await click("Unshare");
  expect(writes).toEqual(["POST", "PUT", "DELETE"]);
  expect(button("Create link")).toBeTruthy();
  expect(
    mocks.fetch.mock.calls.every(([url]) =>
      url.startsWith("https://chat.example.test/api/chat/chat%2Fid/share"),
    ),
  ).toBe(true);
});

it("keeps publication disabled while generating and surfaces server failures without a phantom link", async () => {
  await render(true);
  expect(button("Share chat").disabled).toBe(true);
  await render(false);
  await click("Share chat");
  mocks.fetch.mockImplementationOnce(
    async () =>
      new Response("Wait for the response to finish before sharing.", {
        status: 409,
      }),
  );
  await click("Create link");
  expect(container.textContent).toContain(
    "Wait for the response to finish before sharing.",
  );
  expect(button("Share link")).toBeUndefined();
  expect(button("Create link").disabled).toBe(false);
});

it("uses the configured Cloud share address while connected through LAN", async () => {
  mocks.server = "http://192.168.1.20:4718";
  shared = {
    id: "share-token",
    url: "https://smiths.overtchat.app/share/share-token",
  };
  await render();
  await click("Share chat");
  await click("Share link");
  expect(mocks.share).toHaveBeenCalledWith({
    message: shared.url,
    url: shared.url,
  });
  await click("View shared chat");
  expect(mocks.open).toHaveBeenCalledWith(shared.url);
  expect(
    mocks.fetch.mock.calls.every(([url]) => url.startsWith(mocks.server)),
  ).toBe(true);
});

it("shares a LAN address when the server has no public address", async () => {
  mocks.server = "http://192.168.1.20:4718";
  await render();
  await click("Share chat");
  await click("Create link");
  await click("Share link");
  expect(mocks.share).toHaveBeenCalledWith({
    message: "http://192.168.1.20:4718/share/share-token",
    url: "http://192.168.1.20:4718/share/share-token",
  });
});
