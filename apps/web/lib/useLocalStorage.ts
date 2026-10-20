"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "overtchat:localstorage";
const parsedValues = new Map<string, { raw: string; value: unknown }>();
const memoryValues = new Map<string, unknown>();

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      if (memoryValues.has(key)) return memoryValues.get(key) as T;
      let raw: string | null;
      try {
        raw = window.localStorage.getItem(key);
      } catch {
        return (parsedValues.get(key)?.value as T | undefined) ?? defaultValue;
      }
      if (raw === null) return defaultValue;
      const cached = parsedValues.get(key);
      if (cached?.raw === raw) return cached.value as T;
      try {
        const parsed = JSON.parse(raw) as T;
        parsedValues.set(key, { raw, value: parsed });
        return parsed;
      } catch {
        return defaultValue;
      }
    },
    () => defaultValue,
  );

  const setValue = useCallback(
    (next: T) => {
      const raw = JSON.stringify(next);
      try {
        window.localStorage.setItem(key, raw);
        memoryValues.delete(key);
      } catch {
        // Storage may be unavailable; keep device preferences usable in memory.
        memoryValues.set(key, next);
      }
      parsedValues.set(key, { raw, value: next });
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key],
  );

  return [value, setValue];
}
