import { auth } from "@/lib/auth/server";
import type { ActivityProfileResponse } from "@/lib/activity/types";
import {
  getUsageMember,
  getUsageTrackingStart,
  getUserUsageTotals,
  listUserDailyUsage,
  listUserModelUsage,
} from "@/lib/db/usage";

const PROFILE_DAYS = 370;

function readTimeZone(req: Request): string {
  const value = new URL(req.url).searchParams.get("timeZone") ?? "UTC";
  if (value.length > 100) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter(
        ({ type }) => type === "year" || type === "month" || type === "day",
      )
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { userId } = await params;
  const member = await getUsageMember(userId);
  if (!member) return new Response("Not found", { status: 404 });

  const now = Date.now();
  const timeZone = readTimeZone(req);
  const [totals, daily, models, trackingStartedAt] = await Promise.all([
    getUserUsageTotals(userId),
    listUserDailyUsage(userId, {
      timeZone,
      from: new Date(now - PROFILE_DAYS * 24 * 60 * 60 * 1_000),
    }),
    listUserModelUsage(userId),
    getUsageTrackingStart(userId),
  ]);
  const body: ActivityProfileResponse = {
    member: {
      id: member.id,
      name: member.name,
      image: member.image,
      createdAt: member.createdAt.getTime(),
    },
    throughDate: dateKeyInTimeZone(new Date(now), timeZone),
    trackingStartedAt: trackingStartedAt?.getTime() ?? null,
    totals,
    daily,
    models,
  };
  return Response.json(body);
}
