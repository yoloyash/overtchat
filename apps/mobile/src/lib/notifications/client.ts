import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Alert, AppState, Platform } from "react-native";
import { useSyncExternalStore } from "react";
import { authFetch } from "@/lib/api";
import { parseNotificationTarget } from "./model";

export type NotificationPreferences = {
  chats: boolean;
  agents: boolean;
  previews: boolean;
};
export type NotificationScope = {
  server: string;
  userId: string;
  cookie: string;
};
type Settings = NotificationPreferences & { id: string; token?: string };
const cache = new Map<string, Settings>();
const listeners = new Set<() => void>();
let active: { scope: NotificationScope; viewing: string | null } | undefined;
let operations = Promise.resolve();
const paused = new Set<string>();
const errors = new Map<string, string>();
const INTRO_KEY = "overtchat.pushIntroShown";

function key(scope: NotificationScope) {
  // Encode every UTF-16 code unit, avoiding URL/user delimiter collisions and
  // SecureStore's restricted key alphabet. Each identity gets its own record.
  return (
    "overtchat.push." +
    JSON.stringify([scope.server, scope.userId])
      .split("")
      .map((char) => char.charCodeAt(0).toString(16).padStart(4, "0"))
      .join("")
  );
}
function emit() {
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function notificationSettings(scope: NotificationScope): Settings {
  const id = key(scope);
  let settings = cache.get(id);
  if (!settings) {
    try {
      const saved = JSON.parse(
        SecureStore.getItem(id) ?? "null",
      ) as Settings | null;
      if (
        saved &&
        typeof saved.id === "string" &&
        typeof saved.chats === "boolean" &&
        typeof saved.agents === "boolean" &&
        typeof saved.previews === "boolean"
      )
        settings = saved;
    } catch {
      /* A missing/corrupt preference starts opted out. */
    }
    settings ??= {
      id: Crypto.randomUUID(),
      chats: false,
      agents: false,
      previews: false,
    };
    cache.set(id, settings);
  }
  return settings;
}
function save(scope: NotificationScope, settings: Settings) {
  SecureStore.setItem(key(scope), JSON.stringify(settings));
  cache.set(key(scope), settings);
  emit();
}
export function useNotificationSettings(scope: NotificationScope) {
  const settings = useSyncExternalStore(
    subscribe,
    () => notificationSettings(scope),
    () => notificationSettings(scope),
  );
  const error = useSyncExternalStore(
    subscribe,
    () => errors.get(key(scope)),
    () => undefined,
  );
  return { settings, error };
}
function serialized(task: () => Promise<void>): Promise<void> {
  const operation = operations.then(task);
  operations = operation.catch(() => {});
  return operation;
}

async function updateServer(
  scope: NotificationScope,
  settings: Settings,
  enabled: boolean,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await authFetch(`${scope.server}/api/push-devices`, {
      method: enabled ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json", Cookie: scope.cookie },
      body: JSON.stringify(enabled ? settings : { id: settings.id }),
      signal: controller.signal,
    });
    if (!response.ok && !(response.status === 401 && !enabled)) {
      throw new Error(
        response.status === 404
          ? "Update your OvertChat server to enable notifications."
          : "Couldn't save notification settings on your server. Try again.",
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}
async function permitted(request: boolean) {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("chat-responses", {
      name: "Chat responses",
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync("agent-idle", {
      name: "Agent idle",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (request && !permission.granted && permission.canAskAgain)
    permission = await Notifications.requestPermissionsAsync();
  return (
    permission.granted ||
    permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}
async function register(
  scope: NotificationScope,
  preferences: NotificationPreferences,
  requestPermission: boolean,
) {
  if (paused.has(key(scope))) return;
  let next = { ...notificationSettings(scope), ...preferences };
  const enabled = next.chats || next.agents;
  if (enabled) {
    if (!(await permitted(requestPermission))) {
      await updateServer(scope, next, false);
      throw new Error(
        "Notifications are disabled in your phone's settings. Enable them there, then try again.",
      );
    }
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId)
      throw new Error(
        "This app build isn't configured for push notifications.",
      );
    try {
      next = {
        ...next,
        token: (await Notifications.getExpoPushTokenAsync({ projectId })).data,
      };
    } catch {
      throw new Error(
        "Couldn't register for push notifications. Check your connection and the app's push configuration.",
      );
    }
  }
  if (paused.has(key(scope))) return;
  await updateServer(scope, next, enabled);
  save(scope, next);
}

/** Called only from authenticated, foreground routes. One introduction per device. */
export function showNotificationIntro(scope: NotificationScope) {
  if (
    AppState.currentState !== "active" ||
    !active ||
    key(active.scope) !== key(scope) ||
    paused.has(key(scope))
  )
    return;
  try {
    if (SecureStore.getItem(INTRO_KEY) === "true") return;
    // Persist before showing: rerenders, relaunches, or switching accounts must
    // not repeatedly ask. An interrupted prompt can still be enabled in Settings.
    SecureStore.setItem(INTRO_KEY, "true");
  } catch {
    return;
  }
  const settings = notificationSettings(scope);
  if (settings.chats || settings.agents) return;
  Alert.alert(
    "Know when it’s ready",
    "Get notified when your response is ready or your agent becomes idle.",
    [
      { text: "Not now", style: "cancel" },
      {
        text: "Enable notifications",
        onPress: () => {
          // A dialog may outlive its login; never register a previous identity.
          if (
            !active ||
            key(active.scope) !== key(scope) ||
            paused.has(key(scope))
          )
            return;
          void changeNotificationPreferences(active.scope, {
            chats: true,
            agents: true,
          }).catch((error: unknown) => {
            if (active && key(active.scope) === key(scope)) {
              Alert.alert(
                "Couldn't enable notifications",
                error instanceof Error
                  ? error.message
                  : "Try again in Settings → Notifications.",
              );
            }
          });
        },
      },
    ],
    { cancelable: true },
  );
}

export function changeNotificationPreferences(
  scope: NotificationScope,
  patch: Partial<NotificationPreferences>,
) {
  return serialized(async () => {
    try {
      await register(scope, { ...notificationSettings(scope), ...patch }, true);
      errors.delete(key(scope));
    } catch (error) {
      errors.set(
        key(scope),
        error instanceof Error
          ? error.message
          : "Couldn't update notifications.",
      );
      throw error;
    } finally {
      emit();
    }
  });
}
export function syncNotifications(scope: NotificationScope) {
  if (paused.has(key(scope))) return Promise.resolve();
  const settings = notificationSettings(scope);
  if (!settings.chats && !settings.agents) return Promise.resolve();
  return serialized(async () => {
    try {
      await register(scope, notificationSettings(scope), false);
      errors.delete(key(scope));
    } catch (error) {
      errors.set(
        key(scope),
        error instanceof Error ? error.message : "Couldn't sync notifications.",
      );
    } finally {
      emit();
    }
  });
}
export function setActiveNotificationScope(
  scope: NotificationScope,
  viewing: string | null,
) {
  paused.delete(key(scope));
  active = { scope, viewing };
}
export function clearActiveNotificationScope(scope: NotificationScope) {
  if (active && key(active.scope) === key(scope)) active = undefined;
}
export async function revokeNotifications(scope: NotificationScope) {
  paused.add(key(scope));
  clearActiveNotificationScope(scope);
  try {
    await serialized(() =>
      updateServer(scope, notificationSettings(scope), false),
    );
  } finally {
    await Notifications.dismissAllNotificationsAsync().catch(() => {});
    Notifications.clearLastNotificationResponse();
  }
}

// Install at module load so foreground delivery never shows an unscoped alert.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const settings = active ? notificationSettings(active.scope) : undefined;
    const target = settings
      ? parseNotificationTarget(notification.request.content.data, settings.id)
      : null;
    const show = Boolean(
      target &&
        settings &&
        (target.kind === "chat" ? settings.chats : settings.agents) &&
        !(
          AppState.currentState === "active" &&
          active?.viewing === `${target.kind}:${target.targetId}`
        ),
    );
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: show,
      shouldSetBadge: false,
    };
  },
});
