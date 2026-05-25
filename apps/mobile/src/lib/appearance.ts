import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";

const KEY = "overtchat.themePref";

export type ThemePref = "system" | "light" | "dark";

function read(): ThemePref {
  const v = SecureStore.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

const listeners = new Set<() => void>();
let cached: ThemePref = read();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return cached;
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setThemePref(pref: ThemePref) {
  if (pref === cached) return;
  cached = pref;
  if (pref === "system") {
    SecureStore.deleteItemAsync(KEY).catch(() => {});
  } else {
    SecureStore.setItem(KEY, pref);
  }
  listeners.forEach((cb) => cb());
}

export function getThemePref(): ThemePref {
  return cached;
}
