import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  alert: vi.fn(),
  authFetch: vi.fn(),
  permissions: vi.fn(),
  requestPermissions: vi.fn(),
  token: vi.fn(),
  channel: vi.fn(),
  handler: vi.fn(),
  dismiss: vi.fn(),
  clear: vi.fn(),
  appState: { currentState: "active" },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { eas: { projectId: "project" } } } },
}));
vi.mock("expo-secure-store", () => ({
  getItem: (key: string) => mocks.storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mocks.storage.set(key, value);
  },
}));
vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
  AppState: mocks.appState,
  Platform: { OS: "android" },
}));
vi.mock("@/lib/api", () => ({ authFetch: mocks.authFetch }));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: mocks.permissions,
  requestPermissionsAsync: mocks.requestPermissions,
  getExpoPushTokenAsync: mocks.token,
  setNotificationChannelAsync: mocks.channel,
  setNotificationHandler: mocks.handler,
  AndroidImportance: { HIGH: 4 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  dismissAllNotificationsAsync: mocks.dismiss,
  clearLastNotificationResponse: mocks.clear,
}));
import {
  changeNotificationPreferences,
  notificationSettings,
  revokeNotifications,
  setActiveNotificationScope,
  clearActiveNotificationScope,
  syncNotifications,
  showNotificationIntro,
  type NotificationScope,
} from "./client";
const handleNotification = mocks.handler.mock.calls[0][0].handleNotification;
let scope: NotificationScope;
beforeEach(() => {
  mocks.storage.clear();
  mocks.alert.mockReset();
  scope = {
    server: `http://server-${crypto.randomUUID()}`,
    userId: "alice",
    cookie: "cookie-alice",
  };
  mocks.authFetch
    .mockReset()
    .mockResolvedValue(new Response(null, { status: 204 }));
  mocks.permissions.mockReset().mockResolvedValue({ granted: true });
  mocks.requestPermissions.mockReset().mockResolvedValue({ granted: true });
  mocks.token.mockReset().mockResolvedValue({ data: "ExpoPushToken[device]" });
  mocks.channel.mockReset().mockResolvedValue(null);
  mocks.dismiss.mockReset().mockResolvedValue(null);
  mocks.clear.mockClear();
  mocks.appState.currentState = "active";
});

describe("per-device push settings", () => {
  it("starts opted out without requesting permission or registering", async () => {
    expect(notificationSettings(scope)).toMatchObject({
      chats: false,
      agents: false,
      previews: false,
    });
    await syncNotifications(scope);
    expect(mocks.permissions).not.toHaveBeenCalled();
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });
  it("asks permission only on opt-in and sends scoped authenticated preferences", async () => {
    mocks.permissions.mockResolvedValue({ granted: false, canAskAgain: true });
    await changeNotificationPreferences(scope, { chats: true });
    expect(mocks.requestPermissions).toHaveBeenCalledTimes(1);
    expect(mocks.channel).toHaveBeenCalledTimes(2);
    expect(notificationSettings(scope).chats).toBe(true);
    const [url, init] = mocks.authFetch.mock.calls[0];
    expect(url).toBe(`${scope.server}/api/push-devices`);
    expect(init.headers.Cookie).toBe("cookie-alice");
    expect(JSON.parse(init.body)).toMatchObject({
      chats: true,
      agents: false,
      previews: false,
      token: "ExpoPushToken[device]",
    });
  });
  it("keeps opt-in off on denied permission or registration failure", async () => {
    mocks.permissions.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(
      changeNotificationPreferences(scope, { chats: true }),
    ).rejects.toThrow("phone's settings");
    expect(notificationSettings(scope).chats).toBe(false);
    expect(mocks.token).not.toHaveBeenCalled();
    mocks.permissions.mockResolvedValue({ granted: true });
    mocks.authFetch.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(
      changeNotificationPreferences(scope, { chats: true }),
    ).rejects.toThrow("Couldn't save");
    expect(notificationSettings(scope).chats).toBe(false);
  });
  it("revokes server delivery when OS permission is removed without prompting again", async () => {
    await changeNotificationPreferences(scope, { chats: true });
    mocks.permissions.mockResolvedValue({ granted: false, canAskAgain: true });
    await syncNotifications(scope);
    expect(mocks.authFetch.mock.calls.at(-1)?.[1].method).toBe("DELETE");
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });
  it("isolates preferences by user and server", async () => {
    await changeNotificationPreferences(scope, { chats: true });
    const otherUser = notificationSettings({ ...scope, userId: "bob" });
    const otherServer = notificationSettings({
      ...scope,
      server: "http://another-server",
    });
    expect(otherUser.chats).toBe(false);
    expect(otherServer.chats).toBe(false);
    expect(otherUser.id).not.toBe(notificationSettings(scope).id);
    expect(otherServer.id).not.toBe(notificationSettings(scope).id);
  });
  it("suppresses only notifications for the viewed conversation and rejects other identities", async () => {
    await changeNotificationPreferences(scope, { chats: true, agents: true });
    setActiveNotificationScope(scope, "chat:chat-id");
    const data = {
      kind: "chat",
      targetId: "chat-id",
      registrationId: notificationSettings(scope).id,
      notificationId: "notification",
    };
    const incoming = (value: unknown) =>
      handleNotification({ request: { content: { data: value } } });
    expect((await incoming(data)).shouldShowBanner).toBe(false);
    expect(
      (await incoming({ ...data, targetId: "another-chat" })).shouldShowBanner,
    ).toBe(true);
    expect(
      (await incoming({ ...data, registrationId: "other-account" }))
        .shouldShowBanner,
    ).toBe(false);
    mocks.appState.currentState = "background";
    expect((await incoming(data)).shouldShowBanner).toBe(true);
    clearActiveNotificationScope(scope);
    expect((await incoming(data)).shouldShowBanner).toBe(false);
  });
  it("serializes settings changes so the last toggle wins", async () => {
    await Promise.all([
      changeNotificationPreferences(scope, { chats: true }),
      changeNotificationPreferences(scope, { chats: false }),
    ]);
    expect(notificationSettings(scope).chats).toBe(false);
    expect(mocks.authFetch.mock.calls.at(-1)?.[1].method).toBe("DELETE");
  });
  it("revokes on sign-out and prevents a late sync from re-registering", async () => {
    await changeNotificationPreferences(scope, { chats: true });
    await Promise.all([syncNotifications(scope), revokeNotifications(scope)]);
    await syncNotifications(scope);
    expect(mocks.authFetch.mock.calls.at(-1)?.[1].method).toBe("DELETE");
    expect(mocks.dismiss).toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalled();
  });
});

describe("notification introduction after login", () => {
  it("asks once, without requesting Android permission until Enable is chosen", async () => {
    setActiveNotificationScope(scope, null);
    showNotificationIntro(scope);
    showNotificationIntro(scope);
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.alert.mock.calls[0][0]).toBe("Know when it’s ready");
    expect(mocks.permissions).not.toHaveBeenCalled();
    const buttons = mocks.alert.mock.calls[0][2];
    expect(buttons[0]).toMatchObject({ text: "Not now", style: "cancel" });
    mocks.permissions.mockResolvedValue({ granted: false, canAskAgain: true });
    buttons[1].onPress();
    // Queue a no-op preference change to wait for the introduction's operation.
    await changeNotificationPreferences(scope, {});
    expect(mocks.requestPermissions).toHaveBeenCalled();
    expect(notificationSettings(scope)).toMatchObject({
      chats: true,
      agents: true,
      previews: false,
    });
  });
  it("does not nag after dismissal or when switching accounts", () => {
    setActiveNotificationScope(scope, null);
    showNotificationIntro(scope);
    const other = { ...scope, userId: "bob" };
    setActiveNotificationScope(other, null);
    showNotificationIntro(other);
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });
  it("waits until the authenticated app is foregrounded", () => {
    clearActiveNotificationScope(scope);
    showNotificationIntro(scope);
    expect(mocks.alert).not.toHaveBeenCalled();
    setActiveNotificationScope(scope, null);
    mocks.appState.currentState = "background";
    showNotificationIntro(scope);
    expect(mocks.alert).not.toHaveBeenCalled();
    mocks.appState.currentState = "active";
    showNotificationIntro(scope);
    expect(mocks.alert).toHaveBeenCalledTimes(1);
  });
  it("does not ask existing notification users again", async () => {
    await changeNotificationPreferences(scope, { chats: true });
    setActiveNotificationScope(scope, null);
    showNotificationIntro(scope);
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(notificationSettings(scope)).toMatchObject({
      chats: true,
      agents: false,
    });
  });
  it("ignores Enable from a dialog belonging to a previous login", () => {
    setActiveNotificationScope(scope, null);
    showNotificationIntro(scope);
    const enable = mocks.alert.mock.calls[0][2][1].onPress;
    clearActiveNotificationScope(scope);
    enable();
    expect(mocks.permissions).not.toHaveBeenCalled();
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });
});
