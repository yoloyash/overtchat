import type {
  AgentUsageSnapshot,
  AgentUsageWindow,
} from "@overtchat/agent-bridge";

const FIVE_HOURS_MINS = 5 * 60;
const SEVEN_DAYS_MINS = 7 * 24 * 60;

// Named plan windows from Claude Code's /usage data, in display order.
const PLAN_WINDOWS = [
  ["five_hour", "Session", FIVE_HOURS_MINS],
  ["seven_day", "Weekly", SEVEN_DAYS_MINS],
  ["seven_day_opus", "Opus", SEVEN_DAYS_MINS],
  ["seven_day_sonnet", "Sonnet", SEVEN_DAYS_MINS],
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null;
}

function resetSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.floor(time / 1_000) : null;
}

function usageWindow(
  id: string,
  label: string,
  value: unknown,
  windowDurationMins: number | null,
): AgentUsageWindow | null {
  const window = record(value);
  const usedPercent = percent(window?.utilization);
  if (usedPercent === null) return null;
  return {
    id,
    label,
    usedPercent,
    resetsAt: resetSeconds(window?.resets_at),
    windowDurationMins,
  };
}

/**
 * Maps the Claude Agent SDK `get_usage` control response onto the shared
 * account-usage snapshot. The SDK marks the response shape experimental, so
 * every field is read defensively.
 */
export function parseClaudeUsage(value: unknown): AgentUsageSnapshot {
  const response = record(value);
  const planType =
    typeof response?.subscription_type === "string" &&
    response.subscription_type
      ? response.subscription_type
      : null;
  const limits = record(response?.rate_limits);
  if (response?.rate_limits_available !== true || !limits) {
    return {
      planType,
      windows: [],
      credits: null,
      activity: null,
      unavailableReason:
        "Plan limits do not apply to this Claude Code login. API key, Bedrock, and Vertex sessions are billed by usage instead.",
    };
  }

  const windows: AgentUsageWindow[] = [];
  for (const [key, label, duration] of PLAN_WINDOWS) {
    const window = usageWindow(key, label, limits[key], duration);
    if (window) windows.push(window);
  }
  const modelScoped = Array.isArray(limits.model_scoped)
    ? limits.model_scoped
    : [];
  for (const scoped of modelScoped) {
    const name = record(scoped)?.display_name;
    if (typeof name !== "string" || !name.trim()) continue;
    const window = usageWindow(
      `model:${name.trim().toLowerCase()}`,
      name.trim(),
      scoped,
      SEVEN_DAYS_MINS,
    );
    // Older servers report Opus/Sonnet as named windows; avoid listing twice.
    if (
      window &&
      !windows.some(
        (existing) =>
          existing.label.toLowerCase() === window.label.toLowerCase(),
      )
    ) {
      windows.push(window);
    }
  }
  const extra = record(limits.extra_usage);
  if (extra?.is_enabled === true) {
    const window = usageWindow("extra_usage", "Extra usage", extra, null);
    if (window) windows.push(window);
  }

  return {
    planType,
    windows,
    credits: null,
    activity: null,
    unavailableReason: null,
  };
}
