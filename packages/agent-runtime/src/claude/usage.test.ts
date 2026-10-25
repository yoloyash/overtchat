import { describe, expect, it } from "vitest";
import { parseClaudeUsage } from "./usage";

const resetSeconds = (iso: string) => Math.floor(Date.parse(iso) / 1_000);

describe("Claude account usage", () => {
  it("maps plan windows, per-model limits, and enabled extra usage", () => {
    expect(
      parseClaudeUsage({
        session: { total_cost_usd: 0 },
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: {
            utilization: 7,
            resets_at: "2026-10-24T01:29:59.814744+00:00",
            limit_dollars: null,
          },
          seven_day: {
            utilization: 2,
            resets_at: "2026-10-27T01:59:59.814765+00:00",
          },
          seven_day_opus: null,
          seven_day_sonnet: { utilization: 140, resets_at: null },
          // Undocumented buckets are ignored.
          seven_day_cowork: { utilization: 50, resets_at: null },
          model_scoped: [
            {
              display_name: "Fable",
              utilization: 0,
              resets_at: "2026-10-27T02:00:00+00:00",
            },
            { display_name: "sonnet", utilization: 10, resets_at: null },
            { display_name: "", utilization: 10, resets_at: null },
          ],
          extra_usage: {
            is_enabled: true,
            monthly_limit: 5_000,
            used_credits: 1_250,
            utilization: 25,
          },
        },
      }),
    ).toEqual({
      planType: "max",
      windows: [
        {
          id: "five_hour",
          label: "Session",
          usedPercent: 7,
          resetsAt: resetSeconds("2026-10-24T01:29:59.814744+00:00"),
          windowDurationMins: 300,
        },
        {
          id: "seven_day",
          label: "Weekly",
          usedPercent: 2,
          resetsAt: resetSeconds("2026-10-27T01:59:59.814765+00:00"),
          windowDurationMins: 10_080,
        },
        {
          id: "seven_day_sonnet",
          label: "Sonnet",
          usedPercent: 100,
          resetsAt: null,
          windowDurationMins: 10_080,
        },
        {
          id: "model:fable",
          label: "Fable",
          usedPercent: 0,
          resetsAt: resetSeconds("2026-10-27T02:00:00+00:00"),
          windowDurationMins: 10_080,
        },
        {
          id: "extra_usage",
          label: "Extra usage",
          usedPercent: 25,
          resetsAt: null,
          windowDurationMins: null,
        },
      ],
      credits: null,
      activity: null,
      unavailableReason: null,
    });
  });

  it("skips disabled extra usage and windows without utilization", () => {
    expect(
      parseClaudeUsage({
        subscription_type: "pro",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: null, resets_at: null },
          extra_usage: { is_enabled: false, utilization: 0 },
        },
      }).windows,
    ).toEqual([]);
  });

  it("explains when plan limits do not apply", () => {
    expect(
      parseClaudeUsage({
        subscription_type: null,
        rate_limits_available: false,
        rate_limits: null,
      }),
    ).toEqual({
      planType: null,
      windows: [],
      credits: null,
      activity: null,
      unavailableReason: expect.stringContaining("Plan limits do not apply"),
    });
  });
});
