"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "overtchat:localstorage";

const snapshotCache = new Map<string, { raw: string | null; parsed: unknown }>();

function readCached<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return fallback;
  }
  const cached = snapshotCache.get(key);
  if (cached && cached.raw === raw) return cached.parsed as T;
  let parsed: T;
  try {
    parsed = raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    parsed = fallback;
  }
  snapshotCache.set(key, { raw, parsed });
  return parsed;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const getSnapshot = useCallback(
    () => readCached(key, defaultValue),
    [key, defaultValue],
  );
  const getServerSnapshot = useCallback(() => defaultValue, [defaultValue]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: T) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        return;
      }
      snapshotCache.delete(key);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key],
  );

  return [value, setValue];
}
