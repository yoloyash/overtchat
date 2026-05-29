import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import { DEFAULT_FONT_ID, FONT_SANS, type FontId } from "@/lib/fonts";

const KEY = "overtchat.fontPref";

function isFontId(v: string | null): v is FontId {
  return v != null && Object.prototype.hasOwnProperty.call(FONT_SANS, v);
}

function read(): FontId {
  const v = SecureStore.getItem(KEY);
  return isFontId(v) ? v : DEFAULT_FONT_ID;
}

const listeners = new Set<() => void>();
let cached: FontId = read();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return cached;
}

export function useFontPref(): FontId {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setFontPref(id: FontId) {
  if (id === cached) return;
  cached = id;
  // The default needs no stored value — a fresh/cleared device resolves to it.
  if (id === DEFAULT_FONT_ID) {
    SecureStore.deleteItemAsync(KEY).catch(() => {});
  } else {
    SecureStore.setItem(KEY, id);
  }
  listeners.forEach((cb) => cb());
}

export function getFontPref(): FontId {
  return cached;
}
