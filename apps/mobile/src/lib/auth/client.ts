import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { getServerUrl } from "@/lib/server-url";

function createClient() {
  const baseURL = getServerUrl();
  if (!baseURL) throw new Error("Server URL not set");
  return createAuthClient({
    baseURL,
    plugins: [
      expoClient({
        scheme: "overtchat",
        storagePrefix: "overtchat",
        storage: SecureStore,
      }),
    ],
  });
}

// Infer from the configured factory so Expo plugin actions such as getCookie
// remain part of the client type.
type AuthClient = ReturnType<typeof createClient>;
let cached: AuthClient | null = null;

export function getAuthClient(): AuthClient {
  if (!cached) cached = createClient();
  return cached;
}

export function resetAuthClient() {
  cached = null;
}
