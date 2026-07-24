import { useCallback, useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";

type FlagStore = {
  value: boolean;
  listeners: Set<() => void>;
};

const stores = new Map<string, FlagStore>();

function getStore(key: string, initial: boolean): FlagStore {
  const existing = stores.get(key);
  if (existing) return existing;

  const stored = SecureStore.getItem(key);
  const store = {
    value: stored === "1" ? true : stored === "0" ? false : initial,
    listeners: new Set<() => void>(),
  };
  stores.set(key, store);
  return store;
}

export function useSecureFlag(
  key: string,
  initial: boolean,
): [boolean, (value: boolean) => void] {
  const store = getStore(key, initial);
  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    [store],
  );
  const getSnapshot = useCallback(() => store.value, [store]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setValue = useCallback(
    (next: boolean) => {
      if (store.value === next) return;
      store.value = next;
      SecureStore.setItem(key, next ? "1" : "0");
      store.listeners.forEach((listener) => listener());
    },
    [key, store],
  );

  return [value, setValue];
}
