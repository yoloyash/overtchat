"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  ActivityLeaderboardResponse,
  ActivityPeriod,
  ActivityProfileResponse,
} from "@/lib/activity/types";
import { activityKeys } from "@/lib/queries/keys";

export function useActivityLeaderboard(period: ActivityPeriod) {
  return useQuery({
    queryKey: activityKeys.leaderboard(period),
    queryFn: async (): Promise<ActivityLeaderboardResponse> => {
      const response = await fetch(`/api/activity?period=${period}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<ActivityLeaderboardResponse>;
    },
  });
}

export function useActivityProfile(userId: string, timeZone: string) {
  return useQuery({
    queryKey: activityKeys.profile(userId, timeZone),
    queryFn: async (): Promise<ActivityProfileResponse> => {
      const response = await fetch(
        `/api/activity/${encodeURIComponent(userId)}?timeZone=${encodeURIComponent(timeZone)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<ActivityProfileResponse>;
    },
  });
}
