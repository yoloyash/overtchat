import { describe, expect, it } from "vitest";
import type { TaskSchedule } from "@overtchat/shared";
import {
  formatInTimeZone,
  isTimeZone,
  nextRunAfter,
  nextRunsAfter,
} from "./schedule";

const runs = (
  schedule: TaskSchedule,
  timeZone: string,
  after: string,
  count = 3,
) =>
  nextRunsAfter(schedule, timeZone, new Date(after), count).map((date) =>
    date.toISOString(),
  );

describe("isTimeZone", () => {
  it("accepts IANA names and nothing else", () => {
    expect(isTimeZone("Europe/Berlin")).toBe(true);
    expect(isTimeZone("Asia/Calcutta")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("nextRunsAfter", () => {
  it("reads the time of day on the task's own clock", () => {
    const daily: TaskSchedule = { frequency: "daily", hour: 9, minute: 0 };
    expect(runs(daily, "Asia/Kolkata", "2026-11-16T12:00:00Z", 2)).toEqual([
      "2026-11-17T03:30:00.000Z",
      "2026-11-18T03:30:00.000Z",
    ]);
    expect(runs(daily, "America/Los_Angeles", "2026-11-16T12:00:00Z", 1)).toEqual([
      "2026-11-16T17:00:00.000Z",
    ]);
  });

  it("starts strictly after the moment given", () => {
    const daily: TaskSchedule = { frequency: "daily", hour: 9, minute: 0 };
    expect(runs(daily, "UTC", "2026-11-16T09:00:00Z", 1)).toEqual([
      "2026-11-17T09:00:00.000Z",
    ]);
    expect(runs(daily, "UTC", "2026-11-16T08:59:59Z", 1)).toEqual([
      "2026-11-16T09:00:00.000Z",
    ]);
  });

  it("runs every hour at the chosen minute", () => {
    expect(
      runs({ frequency: "hourly", minute: 15 }, "UTC", "2026-11-16T09:20:00Z"),
    ).toEqual([
      "2026-11-16T10:15:00.000Z",
      "2026-11-16T11:15:00.000Z",
      "2026-11-16T12:15:00.000Z",
    ]);
  });

  it("keeps weekdays to Monday through Friday", () => {
    // 2026-11-20 is a Friday.
    expect(
      runs(
        { frequency: "weekdays", hour: 8, minute: 30 },
        "UTC",
        "2026-11-20T00:00:00Z",
      ),
    ).toEqual([
      "2026-11-20T08:30:00.000Z",
      "2026-11-23T08:30:00.000Z",
      "2026-11-24T08:30:00.000Z",
    ]);
  });

  it("runs a weekly task on each chosen day", () => {
    expect(
      runs(
        { frequency: "weekly", daysOfWeek: [0, 6], hour: 8, minute: 0 },
        "Asia/Kolkata",
        "2026-11-16T12:00:00Z",
      ),
    ).toEqual([
      "2026-11-21T02:30:00.000Z",
      "2026-11-22T02:30:00.000Z",
      "2026-11-28T02:30:00.000Z",
    ]);
  });

  it("passes over a month without the chosen day", () => {
    expect(
      runs(
        { frequency: "monthly", dayOfMonth: 31, hour: 9, minute: 0 },
        "UTC",
        "2026-01-31T10:00:00Z",
      ),
    ).toEqual([
      "2026-03-31T09:00:00.000Z",
      "2026-05-31T09:00:00.000Z",
      "2026-07-31T09:00:00.000Z",
    ]);
  });

  it("gives a one-time task its single moment, then nothing", () => {
    const once: TaskSchedule = {
      frequency: "once",
      date: "2026-11-17",
      hour: 9,
      minute: 0,
    };
    expect(runs(once, "Asia/Kolkata", "2026-11-16T00:00:00Z")).toEqual([
      "2026-11-17T03:30:00.000Z",
    ]);
    expect(nextRunAfter(once, "Asia/Kolkata", new Date("2026-11-17T03:30:00Z"))).toBeNull();
  });

  it("runs a time the clocks skip once the gap is over", () => {
    // Berlin goes from 02:00 straight to 03:00 on 2026-03-29.
    expect(
      runs(
        { frequency: "daily", hour: 2, minute: 30 },
        "Europe/Berlin",
        "2026-03-28T12:00:00Z",
      ),
    ).toEqual([
      "2026-03-29T01:00:00.000Z",
      "2026-03-30T00:30:00.000Z",
      "2026-03-31T00:30:00.000Z",
    ]);
  });

  it("runs a time the clocks repeat only once", () => {
    // Berlin has 02:30 twice on 2026-10-25.
    expect(
      runs(
        { frequency: "daily", hour: 2, minute: 30 },
        "Europe/Berlin",
        "2026-10-24T12:00:00Z",
      ),
    ).toEqual([
      "2026-10-25T00:30:00.000Z",
      "2026-10-26T01:30:00.000Z",
      "2026-10-27T01:30:00.000Z",
    ]);
  });

  it("keeps an hourly task an hour apart through a clock change", () => {
    expect(
      runs({ frequency: "hourly", minute: 0 }, "Europe/Berlin", "2026-10-24T23:30:00Z", 4),
    ).toEqual([
      "2026-10-25T00:00:00.000Z",
      "2026-10-25T01:00:00.000Z",
      "2026-10-25T02:00:00.000Z",
      "2026-10-25T03:00:00.000Z",
    ]);
  });
});

describe("formatInTimeZone", () => {
  it("writes local time with the zone's offset on that date", () => {
    const moment = new Date("2026-11-17T03:30:00Z");
    expect(formatInTimeZone(moment, "Asia/Kolkata")).toBe("2026-11-17T09:00:00+05:30");
    expect(formatInTimeZone(moment, "America/New_York")).toBe(
      "2026-11-16T22:30:00-05:00",
    );
    expect(formatInTimeZone(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(
      "2026-07-01T08:00:00-04:00",
    );
    expect(formatInTimeZone(moment, "UTC")).toBe("2026-11-17T03:30:00+00:00");
  });
});
