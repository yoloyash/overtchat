import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
export type ChatPreferences = {
  messageStats: boolean;
  contextMeter: boolean;
  sessionCost: boolean;
  /** Open each reply's thinking and tool steps without a tap. */
  expandActivity: boolean;
};
const KEY = "overtchat.chatDisplay";
const defaults: ChatPreferences = {
  messageStats: false,
  contextMeter: true,
  sessionCost: true,
  expandActivity: false,
};
function read(): ChatPreferences {
  try {
    const saved = JSON.parse(SecureStore.getItem(KEY) ?? "{}");
    return {
      messageStats:
        typeof saved.messageStats === "boolean"
          ? saved.messageStats
          : defaults.messageStats,
      contextMeter:
        typeof saved.contextMeter === "boolean"
          ? saved.contextMeter
          : defaults.contextMeter,
      sessionCost:
        typeof saved.sessionCost === "boolean"
          ? saved.sessionCost
          : defaults.sessionCost,
      expandActivity:
        typeof saved.expandActivity === "boolean"
          ? saved.expandActivity
          : defaults.expandActivity,
    };
  } catch {
    return defaults;
  }
}
let current = read();
const listeners = new Set<() => void>();
export function useChatPreferences() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => current,
    () => current,
  );
}
export function setChatPreferences(patch: Partial<ChatPreferences>) {
  const next = { ...current, ...patch };
  SecureStore.setItem(KEY, JSON.stringify(next));
  current = next;
  listeners.forEach((cb) => cb());
}
