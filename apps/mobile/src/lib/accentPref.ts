import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import { resolveAccentId, type AccentId } from "@overtchat/shared";

const KEY = "overtchat.accentPref";
const listeners = new Set<() => void>();
let cached = resolveAccentId(SecureStore.getItem(KEY));

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return cached;
}

export function useAccentPref(): AccentId {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setAccentPref(id: AccentId) {
  if (id === cached) return;
  SecureStore.setItem(KEY, id);
  cached = id;
  listeners.forEach((cb) => cb());
}
