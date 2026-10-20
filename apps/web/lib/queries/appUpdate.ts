"use client";

import { useQuery } from "@tanstack/react-query";
import { appUpdateKeys } from "@/lib/queries/keys";
import { apiUrl } from "@/lib/api-url";

const UPDATE_STALE_TIME_MS = 60_000;

export type AppUpdateStatus = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
};

export function useAppUpdate(enabled: boolean) {
  return useQuery({
    queryKey: appUpdateKeys.status(),
    queryFn: async (): Promise<AppUpdateStatus> => {
      const response = await fetch(apiUrl("/api/app-update"));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<AppUpdateStatus>;
    },
    enabled,
    retry: 1,
    staleTime: UPDATE_STALE_TIME_MS,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
}

/** The running server's version, rather than the UI bundled into Electron. */
export function useServerVersion(enabled: boolean) {
  return useQuery({
    queryKey: ["server-version", apiUrl("/api/ping")],
    enabled,
    queryFn: async (): Promise<string> => {
      const response = await fetch(apiUrl("/api/ping"));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { version: string };
      return body.version;
    },
    staleTime: UPDATE_STALE_TIME_MS,
  });
}
