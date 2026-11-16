import { describe, expect, it } from "vitest";
import {
  dateOptions,
  dayOfMonthOptions,
  minuteOptions,
  timeOptions,
} from "./scheduledTaskForm";

describe("task form choices", () => {
  it("offers quarter hours, and keeps a time set elsewhere", () => {
    const quarters = timeOptions("09:00", "en-US");
    expect(quarters).toHaveLength(96);
    expect(quarters[0]).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(quarters.find((option) => option.value === "17:45")?.label).toBe("5:45 PM");

    const odd = timeOptions("08:10", "en-US");
    expect(odd).toHaveLength(97);
    const index = odd.findIndex((option) => option.value === "08:10");
    expect(odd[index]).toEqual({ value: "08:10", label: "8:10 AM" });
    expect(odd[index - 1].value).toBe("08:00");
    expect(odd[index + 1].value).toBe("08:15");
    // Nothing is added for a value that is not a time.
    expect(timeOptions("", "en-US")).toHaveLength(96);
  });

  it("offers minutes five apart, and keeps one set elsewhere", () => {
    expect(minuteOptions(0).map((option) => option.label)).toEqual([
      ":00", ":05", ":10", ":15", ":20", ":25", ":30", ":35", ":40", ":45", ":50", ":55",
    ]);
    const odd = minuteOptions(7);
    expect(odd).toHaveLength(13);
    expect(odd[2]).toEqual({ value: "07", label: ":07" });
  });

  it("offers every day of the month", () => {
    const days = dayOfMonthOptions();
    expect(days).toHaveLength(31);
    expect(days[0]).toEqual({ value: "01", label: "1" });
    expect(days[30]).toEqual({ value: "31", label: "31" });
  });

  it("offers today and the days after it, and keeps a date further out", () => {
    const now = new Date(2026, 10, 30, 22, 0);
    const dates = dateOptions("2026-12-01", now, 3, "en-US");
    expect(dates).toEqual([
      { value: "2026-11-30", label: "Mon, Nov 30, 2026" },
      { value: "2026-12-01", label: "Tue, Dec 1, 2026" },
      { value: "2026-12-02", label: "Wed, Dec 2, 2026" },
    ]);
    const far = dateOptions("2027-06-01", now, 3, "en-US");
    expect(far.at(-1)).toEqual({ value: "2027-06-01", label: "Tue, Jun 1, 2027" });
    expect(dateOptions("soon", now, 3, "en-US")).toHaveLength(3);
  });
});
