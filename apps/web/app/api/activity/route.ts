import { auth } from "@/lib/auth/server";
import {
  ACTIVITY_PERIODS,
  type ActivityLeaderboardResponse,
  type ActivityPeriod,
} from "@/lib/activity/types";
import {
  getUsageTrackingStart,
  listUsageLeaderboard,
  type UsageRange,
} from "@/lib/db/usage";

function readPeriod(req: Request): ActivityPeriod {
  const value = new URL(req.url).searchParams.get("period");
  return ACTIVITY_PERIODS.includes(value as ActivityPeriod)
    ? (value as ActivityPeriod)
    : "30d";
}

function rangeForPeriod(period: ActivityPeriod, now: number): UsageRange {
  if (period === "all") return {};
  const days = period === "7d" ? 7 : 30;
  return { from: new Date(now - days * 24 * 60 * 60 * 1_000) };
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const period = readPeriod(req);
  const [entries, trackingStartedAt] = await Promise.all([
    listUsageLeaderboard(rangeForPeriod(period, Date.now())),
    getUsageTrackingStart(),
  ]);
  const body: ActivityLeaderboardResponse = {
    period,
    trackingStartedAt: trackingStartedAt?.getTime() ?? null,
    entries,
  };
  return Response.json(body);
}
