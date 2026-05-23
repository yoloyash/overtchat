import * as SecureStore from "expo-secure-store";

const KEY = "overtchat.serverUrl";

export function getServerUrl(): string | null {
  return SecureStore.getItem(KEY);
}

export function setServerUrl(url: string): void {
  SecureStore.setItem(KEY, url);
}

export async function clearServerUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
