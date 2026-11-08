import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calendarActivityLabel,
  conversationUsesCalendar,
  describeCalendarToolPart,
  formatCalendarEventTime,
  groupMessageParts,
  type CalendarToolPart,
} from "@overtchat/shared";
import { z } from "zod";
import { INTEGRATIONS } from "@/lib/integrations/schema";
import { createIntegrationTestDatabase } from "@/lib/integrations/test-database";
import { sharedMessages } from "@/lib/sharing";

vi.mock("server-only", () => ({}));

const database = createIntegrationTestDatabase("calendar-tools");
let repository: typeof import("@/lib/db/integrations");
let tools: typeof import("./calendar-tools");

beforeAll(async () => {
  repository = await import("@/lib/db/integrations");
  tools = await import("./calendar-tools");
});
beforeEach(() => database.reset());
afterAll(() => database.close());

function connect(scopes: readonly string[]) {
  repository.saveIntegrationAccount({
    userId: "ada",
    provider: "google",
    accountEmail: "ada@example.test",
    refreshToken: "refresh-1",
    accessToken: "access-1",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    scopes: [...scopes],
  });
}

describe("availability", () => {
  it("offers the tools only to a sign-in that covers the calendar", () => {
    repository.saveIntegrationOauthClient("google", {
      clientId: "client-1",
      clientSecret: "secret-1",
    });
    expect(tools.calendarAccess("ada")).toEqual({ status: "unavailable" });

    // Someone who connected Gmail alone has no calendar tools.
    connect(INTEGRATIONS.gmail.scopes);
    expect(tools.calendarAccess("ada")).toEqual({ status: "unavailable" });

    connect([...INTEGRATIONS.gmail.scopes, ...INTEGRATIONS.calendar.scopes]);
    expect(tools.calendarAccess("ada")).toEqual({
      status: "available",
      alwaysOn: false,
    });

    // Each connector has its own switch for every chat.
    repository.setIntegrationAlwaysOn("ada", "calendar", true);
    expect(tools.calendarAccess("ada")).toEqual({
      status: "available",
      alwaysOn: true,
    });
    expect(repository.getIntegration("ada", "gmail").connection?.alwaysOn).toBe(
      false,
    );

    repository.markIntegrationNeedsReconnect({
      userId: "ada",
      provider: "google",
      refreshToken: "refresh-1",
    });
    expect(tools.calendarAccess("ada")).toEqual({
      status: "needs_reconnect",
      alwaysOn: true,
    });
    expect(tools.calendarReconnectPrompt()).toContain(
      "Settings → Tools → Connectors",
    );
  });

  it("treats a chat as using the calendar once a model has, or once the command is typed", () => {
    const user = (text: string) => ({ role: "user", parts: [{ type: "text", text }] });
    const assistant = (type: string) => ({
      role: "assistant",
      parts: [{ type: "text", text: "Done." }, { type }],
    });

    expect(conversationUsesCalendar([])).toBe(false);
    expect(
      conversationUsesCalendar([user("Am I free?"), assistant("tool-gmail_search")]),
    ).toBe(false);
    expect(
      conversationUsesCalendar([
        user("Am I free?"),
        assistant("tool-calendar_list_events"),
        user("Thanks"),
      ]),
    ).toBe(true);
    // A client without the command menu sends the command as text.
    expect(conversationUsesCalendar([user("/calendar am I free Friday?")])).toBe(true);
    expect(conversationUsesCalendar([user("what does /calendar do?")])).toBe(false);
    expect(conversationUsesCalendar([user("/calendars")])).toBe(false);
  });
});

describe("tool inputs", () => {
  const schema = (
    name:
      | "calendar_list_events"
      | "calendar_create_event"
      | "calendar_update_event"
      | "calendar_delete_event",
  ) =>
    tools.createCalendarTools("ada")[name].inputSchema as {
      safeParse: (value: unknown) => {
        success: boolean;
        data?: Record<string, unknown>;
      };
    };

  it("defaults to the user's main calendar and accepts only Google's own IDs", () => {
    const list = schema("calendar_list_events");
    expect(list.safeParse({}).data).toMatchObject({
      calendarId: "primary",
      maxResults: 25,
    });
    expect(
      list.safeParse({ calendarId: "en.usa#holiday@group.v.calendar.google.com" })
        .success,
    ).toBe(true);
    expect(list.safeParse({ calendarId: "primary/events?x=1" }).success).toBe(false);
    expect(list.safeParse({ maxResults: 51 }).success).toBe(false);

    const remove = schema("calendar_delete_event");
    expect(remove.safeParse({ eventId: "abc123_20261106T150000Z" }).success).toBe(true);
    expect(remove.safeParse({ eventId: "../../calendars" }).success).toBe(false);
    expect(remove.safeParse({}).success).toBe(false);
  });

  it("accepts only addresses as guests and one-line titles", () => {
    const add = schema("calendar_create_event");
    const event = { title: "Lunch", start: "2026-11-06T12:00", end: "2026-11-06T13:00" };
    expect(add.safeParse(event).data).toMatchObject({ guests: [] });
    expect(add.safeParse({ ...event, guests: ["grace@example.test"] }).success).toBe(true);
    expect(add.safeParse({ ...event, guests: ["Grace <grace@example.test>"] }).success).toBe(false);
    expect(add.safeParse({ ...event, title: "Lunch\nBcc: x@y.z" }).success).toBe(false);
    expect(add.safeParse({ title: "Lunch", start: "2026-11-06T12:00" }).success).toBe(false);
    // The check runs here; the schema a model reads stays short.
    expect(JSON.stringify(z.toJSONSchema(add as unknown as z.ZodType))).not.toContain("@");
  });

  it("changes an event by its ID, with every other field optional", () => {
    const change = schema("calendar_update_event");
    expect(change.safeParse({ eventId: "e1", title: "Later" }).success).toBe(true);
    expect(change.safeParse({ eventId: "e1", guests: [] }).data).toMatchObject({
      guests: [],
    });
    expect(change.safeParse({ eventId: "e1" }).data).not.toHaveProperty("guests");
    expect(change.safeParse({ title: "Later" }).success).toBe(false);
  });

  it("offers these tools", () => {
    expect(Object.keys(tools.createCalendarTools("ada"))).toEqual([
      "calendar_list_calendars",
      "calendar_list_events",
      "calendar_create_event",
      "calendar_update_event",
      "calendar_delete_event",
    ]);
  });
});

describe("display", () => {
  const part = (overrides: Partial<CalendarToolPart>): CalendarToolPart => ({
    type: "tool-calendar_list_events",
    toolCallId: "call-1",
    state: "output-available",
    ...overrides,
  });
  const lunch = {
    id: "e1",
    title: "Lunch",
    start: "2026-11-06T12:00:00-05:00",
    end: "2026-11-06T13:00:00-05:00",
    allDay: false,
    location: "Cafe",
    description: "private words",
    guests: [{ email: "grace@example.test", response: "accepted" }],
    moreGuests: 2,
    link: "https://www.google.com/calendar/event?eid=abc",
  };
  const listed = part({
    input: { query: "lunch" },
    output: {
      account: "ada@example.test",
      calendarId: "primary",
      timeZone: "America/New_York",
      now: "2026-11-06T09:00:00-05:00",
      hasMore: true,
      events: [
        lunch,
        { title: "", start: "2026-11-07", end: "2026-11-07", allDay: true, status: "cancelled", link: lunch.link },
        { title: "Phish", start: "2026-11-08", end: "2026-11-08", allDay: true, link: "https://evil.example/calendar" },
      ],
    },
  });

  it("shows listed events by time, title and guests, never their descriptions", () => {
    const display = describeCalendarToolPart(listed);

    expect(display).toMatchObject({
      action: "events",
      status: "done",
      title: "Checked calendar",
      detail: "lunch",
      note: "3+ events",
      rows: [
        {
          title: "Lunch",
          start: "2026-11-06T12:00:00-05:00",
          allDay: false,
          location: "Cafe",
          guests: 3,
          gone: false,
          href: "https://www.google.com/calendar/event?eid=abc&authuser=ada%40example.test",
        },
        { title: "(no title)", allDay: true, guests: 0, gone: true },
        { title: "Phish", gone: false },
      ],
    });
    // A cancelled event and a link that is not Google's are not links.
    expect(display.rows[1].href).toBeUndefined();
    expect(display.rows[2].href).toBeUndefined();
    expect(JSON.stringify(display)).not.toContain("private words");
    expect(calendarActivityLabel(listed, true)).toBe("Checking calendar…");
    expect(calendarActivityLabel(listed, false)).toBe("Checked calendar");
  });

  it("shows the event that was added, changed or deleted", () => {
    const output = { account: "ada@example.test", calendarId: "primary", event: lunch };

    expect(
      describeCalendarToolPart(part({ type: "tool-calendar_create_event", output })),
    ).toMatchObject({
      action: "create",
      title: "Added event to calendar",
      rows: [{ title: "Lunch", gone: false }],
    });
    expect(
      describeCalendarToolPart(part({ type: "tool-calendar_update_event", output })),
    ).toMatchObject({ action: "update", title: "Changed event" });

    const deleted = describeCalendarToolPart(
      part({ type: "tool-calendar_delete_event", output }),
    );
    expect(deleted).toMatchObject({
      action: "delete",
      title: "Deleted event",
      rows: [{ title: "Lunch", gone: true }],
    });
    expect(deleted.rows[0].href).toBeUndefined();
  });

  it("shows a running and a failed step, and counts calendars", () => {
    const running = part({
      type: "tool-calendar_create_event",
      state: "input-available",
      input: { title: "Lunch" },
    });
    expect(describeCalendarToolPart(running)).toMatchObject({
      status: "running",
      title: "Adding event",
      rows: [],
    });
    expect(calendarActivityLabel(running, false)).toBe(
      "Google Calendar request did not complete",
    );

    const failed = part({ state: "output-error", errorText: "No such calendar." });
    expect(describeCalendarToolPart(failed)).toMatchObject({
      status: "error",
      error: "No such calendar.",
    });
    expect(calendarActivityLabel(failed, false)).toBe(
      "Google Calendar request failed",
    );

    expect(
      describeCalendarToolPart(
        part({
          type: "tool-calendar_list_calendars",
          output: { calendars: [{ id: "a" }, { id: "b" }] },
        }),
      ),
    ).toMatchObject({ title: "Listed calendars", note: "2 calendars" });
  });

  it("writes an event's time for the viewer", () => {
    const time = (start: string, end: string, allDay = false) =>
      formatCalendarEventTime({ start, end, allDay }, "en-US");

    expect(time("2026-11-06", "2026-11-06", true)).toBe("Fri, Nov 6");
    expect(time("2026-11-06", "2026-11-08", true)).toBe("Fri, Nov 6 – Sun, Nov 8");
    // A timed event shows on the calendar's clock, wherever the viewer is.
    expect(
      time("2026-11-06T10:00:00-05:00", "2026-11-06T10:30:00-05:00").replace(
        /\s/g,
        " ",
      ),
    ).toBe("Fri, Nov 6 · 10:00 AM – 10:30 AM");
    expect(
      time("2026-11-06T22:00:00+05:30", "2026-11-07T01:00:00+05:30").replace(
        /\s/g,
        " ",
      ),
    ).toBe("Fri, Nov 6, 10:00 PM – Sat, Nov 7, 1:00 AM");
    expect(time("", "")).toBe("");
    expect(time("not a time", "")).toBe("");
  });

  it("is a step of the activity timeline, and is left out of a shared link", () => {
    const parts = [listed, { type: "text", text: "You are free at noon." }];
    expect(groupMessageParts(parts as never).map(({ kind }) => kind)).toEqual([
      "activity",
      "text",
    ]);

    const shared = sharedMessages([
      { id: "a1", role: "assistant", parts },
    ] as never);
    expect(JSON.stringify(shared)).not.toContain("Lunch");
    expect(shared[0].parts).toEqual([
      { type: "text", text: "You are free at noon." },
    ]);
  });
});
