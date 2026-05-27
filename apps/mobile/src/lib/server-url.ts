import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

const KEY = "overtchat.serverUrl";
let currentServerUrl = SecureStore.getItem(KEY);
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getServerUrl(): string | null {
  return currentServerUrl;
}

export function useServerUrl(): string | null {
  return useSyncExternalStore(subscribe, getServerUrl, getServerUrl);
}

export function setServerUrl(url: string): void {
  SecureStore.setItem(KEY, url);
  currentServerUrl = url;
  emit();
}

export async function clearServerUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
  currentServerUrl = null;
  emit();
}
