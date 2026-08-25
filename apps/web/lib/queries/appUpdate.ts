"use client";

import { useQuery } from "@tanstack/react-query";
import { appUpdateKeys } from "@/lib/queries/keys";

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
      const response = await fetch("/api/app-update");
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
