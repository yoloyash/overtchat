import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import {
  DEFAULT_WEB_SEARCH_ENABLED,
  WEB_SEARCH_ENABLED_STORAGE_KEY,
} from "@overtchat/shared";

const KEY = WEB_SEARCH_ENABLED_STORAGE_KEY;

function read(): boolean {
  const v = SecureStore.getItem(KEY);
  if (v === "1") return true;
  if (v === "0") return false;
  return DEFAULT_WEB_SEARCH_ENABLED;
}

const listeners = new Set<() => void>();
let cached: boolean = read();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return cached;
}

export function useWebSearchEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setWebSearchEnabled(enabled: boolean) {
  if (enabled === cached) return;
  cached = enabled;
  // The default needs no stored value — a fresh/cleared device resolves to it.
  if (enabled === DEFAULT_WEB_SEARCH_ENABLED) {
    SecureStore.deleteItemAsync(KEY).catch(() => {});
  } else {
    SecureStore.setItem(KEY, enabled ? "1" : "0");
  }
  listeners.forEach((cb) => cb());
}

export function getWebSearchEnabled(): boolean {
  return cached;
}
