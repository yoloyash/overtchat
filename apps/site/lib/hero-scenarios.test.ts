import { describe, expect, it } from "vitest";
import {
  axisTicks,
  HERO_CHAT_START,
  HERO_CHATS,
  HERO_SCENARIOS,
  monthlyForGoal,
  projectBalance,
} from "./hero-scenarios";

describe("hero demo scenarios", () => {
  it("matches the README savings figures", () => {
    const rounded = [10, 20, 30].map(
      (years) => Math.round(projectBalance(400, 0, years) / 100) * 100,
    );
    expect(rounded).toEqual([69200, 208400, 488000]);
  });

  it("finds a monthly deposit that reaches the goal", () => {
    for (const start of [0, 5000]) {
      const monthly = monthlyForGoal(start);
      expect(projectBalance(monthly, start, 30)).toBeGreaterThanOrEqual(1_000_000);
      expect(projectBalance(monthly - 10, start, 30)).toBeLessThan(1_000_000);
    }
  });

  it("opens every sidebar conversation on a known turn", () => {
    for (const chat of HERO_CHATS) {
      expect(HERO_SCENARIOS[HERO_CHAT_START[chat.id]]?.chatId).toBe(chat.id);
    }
  });

  it("keeps every follow-up inside its own conversation", () => {
    for (const scenario of Object.values(HERO_SCENARIOS)) {
      for (const block of scenario.blocks) {
        if (block.kind !== "followups") continue;
        expect(block.items.length).toBeGreaterThan(0);
        for (const followUp of block.items) {
          expect(HERO_SCENARIOS[followUp.next]?.chatId).toBe(scenario.chatId);
          expect(followUp.next).not.toBe(scenario.id);
        }
      }
    }
  });

  it("totals week one to the first bar of the training plan", () => {
    for (const id of ["training-3", "training-4"]) {
      const { blocks } = HERO_SCENARIOS[id];
      const bars = blocks.find((block) => block.kind === "bars");
      const table = blocks.find((block) => block.kind === "table");
      if (bars?.kind !== "bars" || table?.kind !== "table") {
        throw new Error("training plan is missing its chart or table");
      }
      const total = table.rows.reduce(
        (sum, row) => sum + Number.parseInt(row.distance, 10),
        0,
      );
      expect(bars.points[0].value).toBe(total);
    }
  });

  it("keeps axis ticks between zero and the largest value", () => {
    expect(axisTicks(488)).toEqual([0, 200, 400]);
    expect(axisTicks(23)).toEqual([0, 10, 20]);
    expect(axisTicks(1004.4)).toEqual([0, 500, 1000]);
  });
});
