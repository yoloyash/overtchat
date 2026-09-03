import { File as FsFile } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { getAuthClient } from "@/lib/auth/client";
import { getServerUrl } from "@/lib/server-url";

export function getApiBase(): string {
  const url = getServerUrl();
  if (!url) throw new Error("Server URL not set");
  return url;
}

export function getAuthCookie(): string {
  return getAuthClient().getCookie();
}

export function authFetch(
  input: Parameters<typeof expoFetch>[0],
  init: Parameters<typeof expoFetch>[1] = {},
) {
  const cookie = getAuthCookie();
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (cookie && !headers.has("Cookie")) headers.set("Cookie", cookie);
  // Better Auth owns the cookie in SecureStore. Letting NSURLSession also add
  // cookies from its shared jar can send duplicate (and stale) session tokens.
  return expoFetch(input, { ...init, credentials: "omit", headers });
}

export type UploadCategory = "image" | "document" | "text" | "spreadsheet";

export interface UploadResponse {
  url: string;
  mediaType: string;
  filename: string;
  category: UploadCategory;
  size: number;
  pageCount: number | null;
  truncated: boolean;
}

export async function uploadFile(file: {
  uri: string;
  name: string;
  type: string;
}): Promise<UploadResponse> {
  const fsFile = new FsFile(file.uri);
  const form = new FormData();
  form.append("file", fsFile as unknown as Blob, file.name);

  const res = await expoFetch(`${getApiBase()}/api/uploads`, {
    method: "POST",
    body: form,
    credentials: "omit",
    headers: { Cookie: getAuthCookie() },
  });

  const json = (await res.json().catch(() => ({}))) as Partial<UploadResponse> & {
    error?: string;
  };
  if (!res.ok || !json.url || !json.mediaType) {
    throw new Error(json.error ?? `Upload failed (${res.status})`);
  }
  return json as UploadResponse;
}
