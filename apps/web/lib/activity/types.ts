export const ACTIVITY_PERIODS = ["7d", "30d", "all"] as const;

export type ActivityPeriod = (typeof ACTIVITY_PERIODS)[number];

export type ActivityTotals = {
  generations: number;
  pricedGenerations: number;
  inputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  inputCostNanoUsd: number;
  outputCostNanoUsd: number;
  cacheReadCostNanoUsd: number;
  cacheWriteCostNanoUsd: number;
  totalCostNanoUsd: number;
};

export type ActivityLeaderboardEntry = ActivityTotals & {
  userId: string;
  name: string;
  image: string | null;
};

export type ActivityLeaderboardResponse = {
  period: ActivityPeriod;
  trackingStartedAt: number | null;
  entries: ActivityLeaderboardEntry[];
};

export type ActivityProfileResponse = {
  member: {
    id: string;
    name: string;
    image: string | null;
    createdAt: number;
  };
  throughDate: string;
  trackingStartedAt: number | null;
  totals: ActivityTotals;
  daily: Array<ActivityTotals & { date: string }>;
  models: Array<
    ActivityTotals & {
      providerId: string;
      model: string;
    }
  >;
};
