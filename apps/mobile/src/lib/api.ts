import { getCookie } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";
import { getServerUrl } from "@/lib/server-url";

const COOKIE_STORAGE_KEY = "overtchat_cookie";

export function getApiBase(): string {
  const url = getServerUrl();
  if (!url) throw new Error("Server URL not set");
  return url;
}

function readAuthCookie(): string {
  return getCookie(SecureStore.getItem(COOKIE_STORAGE_KEY) ?? "{}");
}

export function authFetch(
  input: Parameters<typeof expoFetch>[0],
  init: Parameters<typeof expoFetch>[1] = {},
) {
  const cookie = readAuthCookie();
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (cookie && !headers.has("Cookie")) headers.set("Cookie", cookie);
  return expoFetch(input, { ...init, headers });
}
