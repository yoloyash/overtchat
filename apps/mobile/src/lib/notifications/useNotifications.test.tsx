import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NotificationResponse } from "expo-notifications";
const mocks = vi.hoisted(() => ({
  userId: "alice" as string | undefined,
  server: "http://server",
  pathname: "/chat",
  last: null as NotificationResponse | null,
  listener: undefined as ((response: NotificationResponse) => void) | undefined,
  push: vi.fn(),
  sync: vi.fn(),
  intro: vi.fn(),
  active: vi.fn(),
  clearActive: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("expo-notifications", () => ({
  DEFAULT_ACTION_IDENTIFIER: "default",
  getLastNotificationResponse: () => mocks.last,
  clearLastNotificationResponse: () => {
    mocks.last = null;
  },
  addPushTokenListener: () => ({ remove: vi.fn() }),
  addNotificationResponseReceivedListener: (
    listener: typeof mocks.listener,
  ) => {
    mocks.listener = listener;
    return { remove: mocks.remove };
  },
}));
vi.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: vi.fn() }),
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: vi.fn() }),
  },
}));
vi.mock("expo-router", () => ({
  router: { push: mocks.push },
  usePathname: () => mocks.pathname,
}));
vi.mock("@/lib/auth/client", () => ({
  getAuthClient: () => ({
    useSession: () => ({
      data: mocks.userId ? { user: { id: mocks.userId } } : null,
    }),
  }),
}));
vi.mock("@/lib/api", () => ({
  getApiBase: () => mocks.server,
  getAuthCookie: () => "cookie",
}));
vi.mock("./client", () => ({
  notificationSettings: ({
    server,
    userId,
  }: {
    server: string;
    userId: string;
  }) => ({ id: `${server}:${userId}` }),
  syncNotifications: mocks.sync,
  showNotificationIntro: mocks.intro,
  setActiveNotificationScope: mocks.active,
  clearActiveNotificationScope: mocks.clearActive,
}));
import { useNotifications } from "./useNotifications";
let root: Root;
const chat = {
  activeChatId: "current",
  isNewChat: false,
  activeProjectId: null,
  openChat: vi.fn(),
  startNewChat: vi.fn(),
};
function Probe() {
  useNotifications(chat);
  return null;
}
function notification(
  kind = "chat",
  registrationId = "http://server:alice",
): NotificationResponse {
  return {
    actionIdentifier: "default",
    notification: {
      date: Date.now(),
      request: {
        identifier: `${kind}-push`,
        trigger: { type: "push" },
        content: {
          title: "Ready",
          subtitle: null,
          body: null,
          categoryIdentifier: null,
          sound: null,
          data: {
            kind,
            registrationId,
            targetId: "target",
            notificationId: "push",
          },
        },
      },
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = "alice";
  mocks.server = "http://server";
  mocks.pathname = "/chat";
  mocks.last = null;
  mocks.listener = undefined;
  mocks.sync.mockResolvedValue(undefined);
  const { window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    vi.stubGlobal(key, value);
  root = createRoot(
    window.document.getElementById("root") as unknown as HTMLElement,
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<Probe />));
}
it("opens the persisted chat on a cold notification launch and consumes it once", async () => {
  mocks.last = notification();
  await render();
  expect(chat.openChat).toHaveBeenCalledExactlyOnceWith("target");
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/(authed)/(drawer)/chat");
  expect(mocks.last).toBeNull();
  await act(async () => mocks.listener?.(notification()));
  expect(mocks.push).toHaveBeenCalledTimes(1);
});
it("opens an agent on a warm notification tap", async () => {
  await render();
  await act(async () => mocks.listener?.(notification("agent")));
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith({
    pathname: "/(authed)/agents/[id]",
    params: { id: "target" },
  });
  expect(chat.openChat).not.toHaveBeenCalled();
});
it("waits for authentication before handling a cold-start notification", async () => {
  mocks.userId = undefined;
  mocks.last = notification();
  await render();
  expect(mocks.push).not.toHaveBeenCalled();
  mocks.userId = "alice";
  await render();
  expect(mocks.push).toHaveBeenCalledTimes(1);
});
it("does not navigate for a different server/account and cleans up on sign-out", async () => {
  mocks.last = notification("chat", "other-server:alice");
  await render();
  expect(mocks.push).not.toHaveBeenCalled();
  mocks.userId = undefined;
  await render();
  expect(mocks.remove).toHaveBeenCalled();
  expect(mocks.clearActive).toHaveBeenCalled();
});

it("introduces notifications only once the login is available", async () => {
  mocks.userId = undefined;
  await render();
  expect(mocks.intro).not.toHaveBeenCalled();
  mocks.userId = "alice";
  await render();
  expect(mocks.intro).toHaveBeenCalledExactlyOnceWith({
    server: "http://server",
    userId: "alice",
    cookie: "cookie",
  });
});
