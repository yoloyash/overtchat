import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { INTEGRATIONS } from "@/lib/integrations/schema";
import { createIntegrationTestDatabase } from "@/lib/integrations/test-database";

vi.mock("server-only", () => ({}));

const database = createIntegrationTestDatabase("calendar-client");
let repository: typeof import("@/lib/db/integrations");
let calendar: typeof import("./calendar");

type Answer = { status?: number; body?: unknown };
interface Recorded {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}

/** Stands in for Google Calendar, answering by method and path. */
function google(route: (request: Recorded) => Answer) {
  const requests: Recorded[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const request: Recorded = {
      path: `${url.pathname.replace("/calendar/v3", "")}${url.search}`,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const answer = route(request);
    return new Response(
      answer.body === undefined ? null : JSON.stringify(answer.body),
      { status: answer.status ?? 200 },
    );
  });
  return requests;
}

const NEW_YORK = { body: { id: "ada@example.test", timeZone: "America/New_York" } };

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

beforeAll(async () => {
  repository = await import("@/lib/db/integrations");
  calendar = await import("./calendar");
});
beforeEach(() => {
  database.reset();
  repository.saveIntegrationOauthClient("google", {
    clientId: "client-1",
    clientSecret: "secret-1",
  });
  connect([...INTEGRATIONS.gmail.scopes, ...INTEGRATIONS.calendar.scopes]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => database.close());

describe("time zones", () => {
  it("reads a clock time in the calendar's zone, across clock changes", () => {
    const instant = (local: string, zone: string) =>
      calendar.zonedTimeToInstant(local, zone).toISOString();

    expect(instant("2026-11-06T09:00:00", "America/New_York")).toBe(
      "2026-11-06T14:00:00.000Z",
    );
    expect(instant("2026-07-06T09:00:00", "America/New_York")).toBe(
      "2026-07-06T13:00:00.000Z",
    );
    // The morning after clocks went back, and the one after they went forward.
    expect(instant("2026-11-01T09:00:00", "America/New_York")).toBe(
      "2026-11-01T14:00:00.000Z",
    );
    expect(instant("2026-03-08T09:00:00", "America/New_York")).toBe(
      "2026-03-08T13:00:00.000Z",
    );
    expect(instant("2026-11-06T09:00:00", "Asia/Kolkata")).toBe(
      "2026-11-06T03:30:00.000Z",
    );
  });

  it("writes an instant as that zone's clock shows it", () => {
    const at = new Date("2026-11-06T14:05:09Z");
    expect(calendar.instantInZone(at, "America/New_York")).toBe(
      "2026-11-06T09:05:09-05:00",
    );
    expect(calendar.instantInZone(at, "Asia/Kolkata")).toBe(
      "2026-11-06T19:35:09+05:30",
    );
    expect(calendar.instantInZone(at, "UTC")).toBe("2026-11-06T14:05:09+00:00");
  });
});

describe("calendars", () => {
  it("lists the user's calendars, their own first, without hidden ones", async () => {
    const requests = google(() => ({
      body: {
        items: [
          { id: "team@group.calendar.google.com", summary: "Team", accessRole: "writer" },
          { id: "holidays", summary: "Holidays", accessRole: "reader", timeZone: "UTC" },
          { id: "old", summary: "Old", accessRole: "owner", hidden: true },
          {
            id: "ada@example.test",
            summary: "ada@example.test",
            summaryOverride: "Ada",
            primary: true,
            accessRole: "owner",
            timeZone: "America/New_York",
          },
        ],
      },
    }));

    await expect(calendar.listCalendars("ada")).resolves.toEqual({
      calendars: [
        {
          id: "ada@example.test",
          name: "Ada",
          primary: true,
          canEdit: true,
          timeZone: "America/New_York",
        },
        { id: "team@group.calendar.google.com", name: "Team", primary: false, canEdit: true },
        { id: "holidays", name: "Holidays", primary: false, canEdit: false, timeZone: "UTC" },
      ],
    });
    expect(requests[0].path).toBe("/users/me/calendarList?maxResults=250");
  });
});

describe("listing events", () => {
  it("covers the next seven days and reports the calendar's clock", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-06T14:05:00Z"), toFake: ["Date"] });
    // The stored token is good for an hour from this moment.
    connect([...INTEGRATIONS.gmail.scopes, ...INTEGRATIONS.calendar.scopes]);
    const requests = google(({ path }) =>
      path === "/calendars/primary"
        ? NEW_YORK
        : {
            body: {
              nextPageToken: "more",
              items: [
                {
                  id: "e1",
                  status: "confirmed",
                  htmlLink: "https://www.google.com/calendar/event?eid=abc",
                  summary: "Standup",
                  description: "<p>Agenda:</p><ul><li>Demo</li></ul>",
                  location: "Room 4",
                  start: { dateTime: "2026-11-06T10:00:00-05:00" },
                  end: { dateTime: "2026-11-06T10:30:00-05:00" },
                  recurringEventId: "series-1",
                  hangoutLink: "https://meet.google.com/abc-defg-hij",
                  organizer: { email: "grace@example.test", displayName: "Grace" },
                  attendees: [
                    { email: "ada@example.test", self: true, responseStatus: "accepted" },
                    { email: "grace@example.test", displayName: "Grace", responseStatus: "accepted" },
                    { email: "linus@example.test", responseStatus: "something-new" },
                    { email: "room-4@resource.calendar.google.com", resource: true },
                  ],
                },
                {
                  id: "e2",
                  summary: " ",
                  start: { date: "2026-11-07" },
                  end: { date: "2026-11-09" },
                  organizer: { email: "ada@example.test", self: true },
                },
              ],
            },
          },
    );

    const result = await calendar.listCalendarEvents("ada", {
      calendarId: "primary",
      maxResults: 25,
    });

    const listing = new URL(`https://x${requests[1].path}`);
    expect(listing.pathname).toBe("/calendars/primary/events");
    expect(Object.fromEntries(listing.searchParams)).toEqual({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: "2026-11-06T14:05:00.000Z",
      timeMax: "2026-11-13T14:05:00.000Z",
      maxResults: "25",
    });
    expect(result).toEqual({
      account: "ada@example.test",
      calendarId: "primary",
      timeZone: "America/New_York",
      now: "2026-11-06T09:05:00-05:00",
      hasMore: true,
      events: [
        {
          id: "e1",
          title: "Standup",
          start: "2026-11-06T10:00:00-05:00",
          end: "2026-11-06T10:30:00-05:00",
          allDay: false,
          location: "Room 4",
          description: "Agenda:\nDemo",
          guests: [
            { email: "grace@example.test", name: "Grace", response: "accepted" },
            { email: "linus@example.test", response: "needsAction" },
          ],
          organizer: "Grace",
          meetingLink: "https://meet.google.com/abc-defg-hij",
          recurring: true,
          link: "https://www.google.com/calendar/event?eid=abc",
        },
        // Google ends an all-day event on the day after its last.
        {
          id: "e2",
          title: "(no title)",
          start: "2026-11-07",
          end: "2026-11-08",
          allDay: true,
        },
      ],
    });
  });

  it("reads dates and clock times in the calendar's zone, a closing date included whole", async () => {
    const requests = google(({ path }) =>
      path === "/calendars/team%40group.calendar.google.com"
        ? NEW_YORK
        : { body: { items: [] } },
    );

    await calendar.listCalendarEvents("ada", {
      calendarId: "team@group.calendar.google.com",
      from: "2026-11-06",
      to: "2026-11-06",
      query: "dentist appointment",
      maxResults: 10,
    });
    await calendar.listCalendarEvents("ada", {
      calendarId: "team@group.calendar.google.com",
      from: "2026-11-06T09:00",
      to: "2026-11-06T17:00:00+01:00",
      maxResults: 10,
    });

    const first = new URL(`https://x${requests[1].path}`).searchParams;
    expect(first.get("timeMin")).toBe("2026-11-06T05:00:00.000Z");
    expect(first.get("timeMax")).toBe("2026-11-07T05:00:00.000Z");
    expect(first.get("q")).toBe("dentist appointment");
    const second = new URL(`https://x${requests[3].path}`).searchParams;
    expect(second.get("timeMin")).toBe("2026-11-06T14:00:00.000Z");
    expect(second.get("timeMax")).toBe("2026-11-06T16:00:00.000Z");
  });

  it("refuses a range it cannot read, before asking for events", async () => {
    const requests = google(() => NEW_YORK);

    await expect(
      calendar.listCalendarEvents("ada", {
        calendarId: "primary",
        from: "next friday",
        maxResults: 10,
      }),
    ).rejects.toThrow("Give from as YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS.");
    await expect(
      calendar.listCalendarEvents("ada", {
        calendarId: "primary",
        from: "2026-11-08",
        to: "2026-11-06",
        maxResults: 10,
      }),
    ).rejects.toThrow("to must be later than from.");
    expect(requests.every(({ path }) => path === "/calendars/primary")).toBe(true);
  });

  it("shortens a long description and a long guest list", async () => {
    google(({ path }) =>
      path === "/calendars/primary"
        ? NEW_YORK
        : {
            body: {
              items: [
                {
                  id: "e1",
                  summary: "All hands",
                  description: "x".repeat(1_500),
                  start: { dateTime: "2026-11-06T10:00:00-05:00" },
                  end: { dateTime: "2026-11-06T11:00:00-05:00" },
                  attendees: Array.from({ length: 30 }, (_, index) => ({
                    email: `guest-${index}@example.test`,
                  })),
                },
              ],
            },
          },
    );

    const { events } = await calendar.listCalendarEvents("ada", {
      calendarId: "primary",
      maxResults: 10,
    });

    expect(events[0].description).toBe(`${"x".repeat(1_000)}…`);
    expect(events[0].guests).toHaveLength(25);
    expect(events[0].moreGuests).toBe(5);
  });
});

describe("adding events", () => {
  const created = {
    id: "new-1",
    summary: "Lunch",
    htmlLink: "https://www.google.com/calendar/event?eid=new",
    start: { dateTime: "2026-11-06T12:00:00-05:00" },
    end: { dateTime: "2026-11-06T13:00:00-05:00" },
  };

  it("puts a clock time on the calendar's own clock and invites the guests", async () => {
    const requests = google(({ path }) =>
      path === "/calendars/primary" ? NEW_YORK : { body: created },
    );

    const result = await calendar.createCalendarEvent("ada", {
      calendarId: "primary",
      title: "Lunch",
      start: "2026-11-06T12:00",
      end: "2026-11-06T13:00:00",
      location: "Cafe",
      description: "Bring the report",
      guests: ["grace@example.test"],
    });

    // Google is not asked to email the guests.
    expect(requests[1]).toEqual({
      path: "/calendars/primary/events",
      method: "POST",
      body: {
        summary: "Lunch",
        start: { dateTime: "2026-11-06T12:00:00", timeZone: "America/New_York" },
        end: { dateTime: "2026-11-06T13:00:00", timeZone: "America/New_York" },
        location: "Cafe",
        description: "Bring the report",
        attendees: [{ email: "grace@example.test" }],
      },
    });
    expect(result).toMatchObject({
      account: "ada@example.test",
      calendarId: "primary",
      event: { id: "new-1", title: "Lunch", allDay: false },
    });
  });

  it("keeps a time that names its own offset, without asking for the zone", async () => {
    const requests = google(() => ({ body: created }));

    await calendar.createCalendarEvent("ada", {
      calendarId: "primary",
      title: "Call",
      start: "2026-11-06T12:00:00+01:00",
      end: "2026-11-06T12:30:00Z",
      guests: [],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      summary: "Call",
      start: { dateTime: "2026-11-06T12:00:00+01:00" },
      end: { dateTime: "2026-11-06T12:30:00Z" },
    });
  });

  it("ends an all-day event on its last day", async () => {
    const requests = google(() => ({
      body: { id: "trip", summary: "Trip", start: { date: "2026-11-06" }, end: { date: "2026-11-09" } },
    }));

    const result = await calendar.createCalendarEvent("ada", {
      calendarId: "primary",
      title: "Trip",
      start: "2026-11-06",
      end: "2026-11-08",
      guests: [],
    });

    expect(requests[0].body).toMatchObject({
      start: { date: "2026-11-06" },
      end: { date: "2026-11-09" },
    });
    expect(result.event).toMatchObject({
      start: "2026-11-06",
      end: "2026-11-08",
      allDay: true,
    });
  });

  it("refuses times it cannot read without asking Google", async () => {
    const requests = google(() => ({ body: created }));
    const add = (start: string, end: string) =>
      calendar.createCalendarEvent("ada", {
        calendarId: "primary",
        title: "Lunch",
        start,
        end,
        guests: [],
      });

    await expect(add("2026-11-06", "2026-11-06T13:00")).rejects.toThrow(
      /both as dates/,
    );
    await expect(add("noon", "1pm")).rejects.toThrow(/both as dates/);
    await expect(add("2026-11-08", "2026-11-06")).rejects.toThrow(
      "end must not be before start.",
    );
    expect(requests).toHaveLength(0);
  });
});

describe("changing events", () => {
  it("sends only what changes", async () => {
    const requests = google(() => ({
      body: {
        id: "e1",
        summary: "Lunch with Grace",
        start: { dateTime: "2026-11-06T12:00:00-05:00" },
        end: { dateTime: "2026-11-06T13:00:00-05:00" },
      },
    }));

    const result = await calendar.updateCalendarEvent("ada", {
      calendarId: "primary",
      eventId: "e1",
      title: "Lunch with Grace",
      location: "",
    });

    expect(requests).toEqual([
      {
        path: "/calendars/primary/events/e1",
        method: "PATCH",
        body: { summary: "Lunch with Grace", location: "" },
      },
    ]);
    expect(result.event.title).toBe("Lunch with Grace");
  });

  it("keeps the answers of guests who stay on the list", async () => {
    const requests = google(({ method }) => ({
      body: {
        id: "e1",
        summary: "Review",
        start: { dateTime: "2026-11-06T12:00:00-05:00" },
        end: { dateTime: "2026-11-06T13:00:00-05:00" },
        attendees:
          method === "GET"
            ? [
                { email: "Grace@example.test", responseStatus: "accepted" },
                { email: "linus@example.test", responseStatus: "declined" },
              ]
            : [],
      },
    }));

    await calendar.updateCalendarEvent("ada", {
      calendarId: "primary",
      eventId: "e1",
      guests: ["grace@example.test", "alan@example.test"],
    });

    expect(requests.map(({ method }) => method)).toEqual(["GET", "PATCH"]);
    expect(requests[1].body).toEqual({
      attendees: [
        { email: "Grace@example.test", responseStatus: "accepted" },
        { email: "alan@example.test" },
      ],
    });
  });

  it("moves an event only when given both ends, and needs something to change", async () => {
    const requests = google(() => ({ body: {} }));

    await expect(
      calendar.updateCalendarEvent("ada", {
        calendarId: "primary",
        eventId: "e1",
        start: "2026-11-06T12:00:00Z",
      }),
    ).rejects.toThrow("Give both start and end to move an event.");
    await expect(
      calendar.updateCalendarEvent("ada", { calendarId: "primary", eventId: "e1" }),
    ).rejects.toThrow("Name at least one thing to change.");
    expect(requests).toHaveLength(0);
  });
});

describe("deleting events", () => {
  it("reports what it deleted", async () => {
    const requests = google(({ method }) =>
      method === "DELETE"
        ? { status: 204 }
        : {
            body: {
              id: "e1",
              summary: "Dentist",
              htmlLink: "https://www.google.com/calendar/event?eid=abc",
              start: { dateTime: "2026-11-06T12:00:00-05:00" },
              end: { dateTime: "2026-11-06T13:00:00-05:00" },
            },
          },
    );

    const result = await calendar.deleteCalendarEvent("ada", {
      calendarId: "primary",
      eventId: "e1",
    });

    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /calendars/primary/events/e1",
      "DELETE /calendars/primary/events/e1",
    ]);
    expect(result.event).toMatchObject({ id: "e1", title: "Dentist" });
  });

  it("says so when the event is already gone", async () => {
    google(({ method }) =>
      method === "DELETE"
        ? { status: 410, body: { error: { message: "Resource has been deleted" } } }
        : { body: { id: "e1", status: "cancelled" } },
    );

    await expect(
      calendar.deleteCalendarEvent("ada", { calendarId: "primary", eventId: "e1" }),
    ).rejects.toThrow("Google Calendar has no calendar or event with that ID.");
  });
});

describe("access", () => {
  it("works only for a sign-in that covers the calendar", async () => {
    connect(INTEGRATIONS.gmail.scopes);
    const requests = google(() => ({ body: {} }));

    await expect(calendar.listCalendars("ada")).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(requests).toHaveLength(0);
  });

  it("passes on where to sign in again once Google has ended the sign-in", async () => {
    repository.markIntegrationNeedsReconnect({
      userId: "ada",
      provider: "google",
      refreshToken: "refresh-1",
    });

    await expect(calendar.listCalendars("ada")).rejects.toThrow(
      calendar.CALENDAR_RECONNECT_MESSAGE,
    );
  });

  it("names the API an administrator has to enable", async () => {
    google(() => ({
      status: 403,
      body: {
        error: {
          message:
            "Google Calendar API has not been used in project 42 before or it is disabled.",
        },
      },
    }));

    await expect(calendar.listCalendars("ada")).rejects.toThrow(
      "Google Calendar refused the request: Google Calendar API has not been used in project 42 before or it is disabled.",
    );
  });
});
