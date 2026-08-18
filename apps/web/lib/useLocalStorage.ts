"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "overtchat:localstorage";
const parsedValues = new Map<string, { raw: string; value: unknown }>();

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      const raw = window.localStorage.getItem(key);
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
      window.localStorage.setItem(key, raw);
      parsedValues.set(key, { raw, value: next });
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key],
  );

  return [value, setValue];
}
