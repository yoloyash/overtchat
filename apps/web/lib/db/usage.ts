import "server-only";
import { and, asc, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { generationUsage, user } from "@/lib/db/schema";

export type UsageRange = {
  from?: Date;
  to?: Date;
};

export type UsageTotals = {
  generations: number;
  inputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};

export type UsageLeaderboardEntry = UsageTotals & {
  userId: string;
  name: string;
  image: string | null;
};

export type DailyUsage = UsageTotals & {
  date: string;
};

export type ModelUsage = UsageTotals & {
  providerId: string;
  model: string;
};

export type UsageMember = {
  id: string;
  name: string;
  image: string | null;
  createdAt: Date;
};

const effectiveTotalTokens = sql`
  coalesce(
    ${generationUsage.totalTokens},
    coalesce(${generationUsage.inputTokens}, 0)
      + coalesce(${generationUsage.outputTokens}, 0)
  )
`;

function rangeConditions(range: UsageRange): SQL[] {
  return [
    ...(range.from ? [gte(generationUsage.occurredAt, range.from)] : []),
    ...(range.to ? [lt(generationUsage.occurredAt, range.to)] : []),
  ];
}

function aggregateUsage() {
  return {
    generations: sql<number>`count(${generationUsage.id})`,
    inputTokens: sql<number>`coalesce(sum(${generationUsage.inputTokens}), 0)`,
    uncachedInputTokens:
      sql<number>`coalesce(sum(${generationUsage.uncachedInputTokens}), 0)`,
    outputTokens:
      sql<number>`coalesce(sum(${generationUsage.outputTokens}), 0)`,
    cacheReadTokens:
      sql<number>`coalesce(sum(${generationUsage.cacheReadTokens}), 0)`,
    cacheWriteTokens:
      sql<number>`coalesce(sum(${generationUsage.cacheWriteTokens}), 0)`,
    totalTokens: sql<number>`coalesce(sum(${effectiveTotalTokens}), 0)`,
  };
}

export async function listUsageLeaderboard(
  range: UsageRange = {},
): Promise<UsageLeaderboardEntry[]> {
  const totals = aggregateUsage();
  return db
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
      ...totals,
    })
    .from(user)
    .leftJoin(
      generationUsage,
      and(eq(generationUsage.userId, user.id), ...rangeConditions(range)),
    )
    .groupBy(user.id)
    .orderBy(desc(totals.totalTokens), asc(user.name));
}

export async function listUserModelUsage(
  userId: string,
  range: UsageRange = {},
): Promise<ModelUsage[]> {
  const totals = aggregateUsage();
  return db
    .select({
      providerId: generationUsage.providerId,
      model: generationUsage.model,
      ...totals,
    })
    .from(generationUsage)
    .where(
      and(eq(generationUsage.userId, userId), ...rangeConditions(range)),
    )
    .groupBy(generationUsage.providerId, generationUsage.model)
    .orderBy(desc(totals.generations), desc(totals.totalTokens));
}

export async function getChatUsageTotals(
  chatId: string,
  userId: string,
): Promise<UsageTotals> {
  const [totals] = await db
    .select(aggregateUsage())
    .from(generationUsage)
    .where(
      and(
        eq(generationUsage.chatId, chatId),
        eq(generationUsage.userId, userId),
      ),
    );
  return totals;
}

export async function getUserUsageTotals(
  userId: string,
  range: UsageRange = {},
): Promise<UsageTotals> {
  const [totals] = await db
    .select(aggregateUsage())
    .from(generationUsage)
    .where(
      and(eq(generationUsage.userId, userId), ...rangeConditions(range)),
    );
  return totals;
}

export async function getUsageMember(
  userId: string,
): Promise<UsageMember | null> {
  const [member] = await db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return member ?? null;
}

export async function getUsageTrackingStart(
  userId?: string,
): Promise<Date | null> {
  const [row] = await db
    .select({
      occurredAt:
        sql`min(${generationUsage.occurredAt})`.mapWith(
          generationUsage.occurredAt,
        ),
    })
    .from(generationUsage)
    .where(userId ? eq(generationUsage.userId, userId) : undefined);
  return row.occurredAt;
}

export async function listUserDailyUsage(
  userId: string,
  {
    timeZone,
    ...range
  }: UsageRange & { timeZone: string },
): Promise<DailyUsage[]> {
  const rows = await db
    .select({
      occurredAt: generationUsage.occurredAt,
      inputTokens: generationUsage.inputTokens,
      uncachedInputTokens: generationUsage.uncachedInputTokens,
      outputTokens: generationUsage.outputTokens,
      cacheReadTokens: generationUsage.cacheReadTokens,
      cacheWriteTokens: generationUsage.cacheWriteTokens,
      totalTokens: sql<number>`${effectiveTotalTokens}`,
    })
    .from(generationUsage)
    .where(
      and(eq(generationUsage.userId, userId), ...rangeConditions(range)),
    )
    .orderBy(asc(generationUsage.occurredAt));

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const byDate = new Map<string, DailyUsage>();

  for (const row of rows) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(row.occurredAt)
        .filter(({ type }) => type === "year" || type === "month" || type === "day")
        .map(({ type, value }) => [type, value]),
    );
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const current = byDate.get(date) ?? {
      date,
      generations: 0,
      inputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    };
    current.generations += 1;
    current.inputTokens += row.inputTokens ?? 0;
    current.uncachedInputTokens += row.uncachedInputTokens ?? 0;
    current.outputTokens += row.outputTokens ?? 0;
    current.cacheReadTokens += row.cacheReadTokens ?? 0;
    current.cacheWriteTokens += row.cacheWriteTokens ?? 0;
    current.totalTokens += row.totalTokens;
    byDate.set(date, current);
  }

  return [...byDate.values()];
}
