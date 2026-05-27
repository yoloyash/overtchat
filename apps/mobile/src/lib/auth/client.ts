import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { getServerUrl } from "@/lib/server-url";

let cached: ReturnType<typeof createAuthClient> | null = null;

export function getAuthClient() {
  if (cached) return cached;
  const baseURL = getServerUrl();
  if (!baseURL) throw new Error("Server URL not set");
  cached = createAuthClient({
    baseURL,
    plugins: [
      expoClient({
        scheme: "overtchat",
        storagePrefix: "overtchat",
        storage: SecureStore,
      }),
    ],
  });
  return cached;
}

export function resetAuthClient() {
  cached = null;
}
