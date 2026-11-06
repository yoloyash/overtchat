import "server-only";
import type {
  CalendarEvent,
  CalendarEventOutput,
  CalendarEventsOutput,
  CalendarGuest,
  CalendarListOutput,
} from "@overtchat/shared";
import { getIntegrationConnection } from "@/lib/db/integrations";
import { IntegrationError } from "@/lib/integrations/errors";
import { htmlToText } from "@/lib/integrations/google/gmail";
import {
  googleRequest,
  type GoogleService,
} from "@/lib/integrations/google/request";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** How far ahead events are listed when no range is given. */
const DEFAULT_RANGE_DAYS = 7;

/** One event's description and guest list, as much as a result carries. */
const MAX_DESCRIPTION_CHARS = 1_000;
const MAX_GUESTS = 25;

/** Read by the person in a failed step and by the model, which passes it on. */
export const CALENDAR_RECONNECT_MESSAGE =
  "The Google Calendar sign-in has ended. Reconnect Google Calendar in the OvertChat web app under Settings → Tools → Connectors.";

const CALENDAR: GoogleService = {
  integrationId: "calendar",
  name: "Google Calendar",
  reconnectMessage: CALENDAR_RECONNECT_MESSAGE,
  notFoundMessage: "Google Calendar has no calendar or event with that ID.",
};

interface ApiEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface ApiAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  /** A room or a piece of equipment. */
  resource?: boolean;
}

interface ApiEvent {
  id?: string;
  status?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: ApiEventTime;
  end?: ApiEventTime;
  recurringEventId?: string;
  hangoutLink?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: ApiAttendee[];
}

interface ApiCalendar {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
  hidden?: boolean;
  deleted?: boolean;
}

function calendarRequest<T>(
  userId: string,
  path: string,
  options: {
    method?: "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  return googleRequest<T>(userId, CALENDAR, `${CALENDAR_API}${path}`, options);
}

/** The account results are labeled with, so links open the right calendar. */
function account(userId: string): string {
  return getIntegrationConnection(userId, "calendar")?.accountEmail ?? "";
}

function eventsPath(calendarId: string, eventId?: string): string {
  return `/calendars/${encodeURIComponent(calendarId)}/events${
    eventId ? `/${encodeURIComponent(eventId)}` : ""
  }`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_TIME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/** The calendar day `days` after (or before) another. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** How far a time zone's clock is ahead of UTC at one instant. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value);
  const clock = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return clock - Math.floor(instant / 1000) * 1000;
}

/** The instant a clock in `timeZone` shows `local` (YYYY-MM-DDTHH:MM:SS). */
export function zonedTimeToInstant(local: string, timeZone: string): Date {
  const clock = Date.parse(`${local}Z`);
  // The offset at the clock time is right except across a clock change, so
  // it is read again at the instant it leads to.
  const near = clock - zoneOffsetMs(clock, timeZone);
  return new Date(clock - zoneOffsetMs(near, timeZone));
}

/** An instant as a clock in `timeZone` shows it, with its offset. */
export function instantInZone(instant: Date, timeZone: string): string {
  const offset = zoneOffsetMs(instant.getTime(), timeZone);
  const minutes = Math.abs(Math.round(offset / 60_000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${new Date(instant.getTime() + offset).toISOString().slice(0, 19)}${
    offset < 0 ? "-" : "+"
  }${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function usableTimeZone(timeZone: string | undefined): string {
  try {
    if (timeZone) {
      new Intl.DateTimeFormat("en-US", { timeZone });
      return timeZone;
    }
  } catch {
    // Fall through: a zone this server does not know is read as UTC.
  }
  return "UTC";
}

async function calendarTimeZone(
  userId: string,
  calendarId: string,
  signal?: AbortSignal,
): Promise<string> {
  const calendar = await calendarRequest<ApiCalendar>(
    userId,
    `/calendars/${encodeURIComponent(calendarId)}`,
    { signal },
  );
  return usableTimeZone(calendar.timeZone);
}

function badTime(name: string): IntegrationError {
  return new IntegrationError(
    `Give ${name} as YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS.`,
    400,
  );
}

/** One end of a range to list, as the instant Google wants. */
function rangeInstant(
  name: string,
  value: string,
  timeZone: string,
  /** A date as the end of a range includes that whole day. */
  wholeDay: boolean,
): Date {
  if (DAY.test(value)) {
    return zonedTimeToInstant(
      `${wholeDay ? shiftDay(value, 1) : value}T00:00:00`,
      timeZone,
    );
  }
  const match = DAY_TIME.exec(value);
  if (!match) throw badTime(name);
  const [, day, time, seconds = ":00", offset] = match;
  const instant = offset
    ? new Date(`${day}T${time}${seconds}${offset}`)
    : zonedTimeToInstant(`${day}T${time}${seconds}`, timeZone);
  if (Number.isNaN(instant.getTime())) throw badTime(name);
  return instant;
}

function plainDescription(description: string): string {
  const plain = /<[a-z][^>]*>/i.test(description)
    ? htmlToText(description)
    : description.trim();
  return plain.length > MAX_DESCRIPTION_CHARS
    ? `${plain.slice(0, MAX_DESCRIPTION_CHARS)}…`
    : plain;
}

const RESPONSES = ["accepted", "declined", "tentative", "needsAction"] as const;

function toEvent(event: ApiEvent): CalendarEvent {
  const allDay = Boolean(event.start?.date);
  const guests: CalendarGuest[] = [];
  for (const attendee of event.attendees ?? []) {
    if (attendee.self || attendee.resource || !attendee.email) continue;
    guests.push({
      email: attendee.email,
      ...(attendee.displayName ? { name: attendee.displayName } : {}),
      response:
        RESPONSES.find((response) => response === attendee.responseStatus) ??
        "needsAction",
    });
  }
  const organizer =
    event.organizer && !event.organizer.self
      ? (event.organizer.displayName ?? event.organizer.email)
      : undefined;
  const description = event.description
    ? plainDescription(event.description)
    : "";
  return {
    id: event.id ?? "",
    title: event.summary?.trim() || "(no title)",
    start: event.start?.date ?? event.start?.dateTime ?? "",
    // Google names the day after an all-day event as its end.
    end: event.end?.date
      ? shiftDay(event.end.date, -1)
      : (event.end?.dateTime ?? ""),
    allDay,
    ...(event.location ? { location: event.location } : {}),
    ...(description ? { description } : {}),
    ...(guests.length > 0 ? { guests: guests.slice(0, MAX_GUESTS) } : {}),
    ...(guests.length > MAX_GUESTS
      ? { moreGuests: guests.length - MAX_GUESTS }
      : {}),
    ...(organizer ? { organizer } : {}),
    ...(event.hangoutLink ? { meetingLink: event.hangoutLink } : {}),
    ...(event.recurringEventId ? { recurring: true } : {}),
    ...(event.status === "cancelled" || event.status === "tentative"
      ? { status: event.status }
      : {}),
    ...(event.htmlLink ? { link: event.htmlLink } : {}),
  };
}

export async function listCalendars(
  userId: string,
  signal?: AbortSignal,
): Promise<CalendarListOutput> {
  const listed = await calendarRequest<{ items?: ApiCalendar[] }>(
    userId,
    "/users/me/calendarList?maxResults=250",
    { signal },
  );
  const calendars = (listed.items ?? [])
    .filter((calendar) => calendar.id && !calendar.hidden && !calendar.deleted)
    .map((calendar) => ({
      id: calendar.id!,
      name: calendar.summaryOverride ?? calendar.summary ?? calendar.id!,
      primary: calendar.primary === true,
      canEdit:
        calendar.accessRole === "owner" || calendar.accessRole === "writer",
      ...(calendar.timeZone ? { timeZone: calendar.timeZone } : {}),
    }));
  return {
    calendars: [
      ...calendars.filter((calendar) => calendar.primary),
      ...calendars.filter((calendar) => !calendar.primary),
    ],
  };
}

export async function listCalendarEvents(
  userId: string,
  input: {
    calendarId: string;
    from?: string;
    to?: string;
    query?: string;
    maxResults: number;
  },
  signal?: AbortSignal,
): Promise<CalendarEventsOutput> {
  const timeZone = await calendarTimeZone(userId, input.calendarId, signal);
  const now = new Date();
  const from = input.from
    ? rangeInstant("from", input.from, timeZone, false)
    : now;
  const to = input.to
    ? rangeInstant("to", input.to, timeZone, true)
    : new Date(from.getTime() + DEFAULT_RANGE_DAYS * 86_400_000);
  if (to.getTime() <= from.getTime()) {
    throw new IntegrationError("to must be later than from.", 400);
  }

  const query = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    maxResults: String(input.maxResults),
    ...(input.query ? { q: input.query } : {}),
  });
  const listed = await calendarRequest<{
    items?: ApiEvent[];
    nextPageToken?: string;
  }>(userId, `${eventsPath(input.calendarId)}?${query}`, { signal });

  return {
    account: account(userId),
    calendarId: input.calendarId,
    timeZone,
    now: instantInZone(now, timeZone),
    events: (listed.items ?? []).map(toEvent),
    hasMore: Boolean(listed.nextPageToken),
  };
}

/** An event's start and end as Google stores them. */
async function eventTimes(
  userId: string,
  calendarId: string,
  start: string,
  end: string,
  signal?: AbortSignal,
): Promise<{ start: ApiEventTime; end: ApiEventTime }> {
  if (DAY.test(start) && DAY.test(end)) {
    if (end < start) {
      throw new IntegrationError("end must not be before start.", 400);
    }
    return { start: { date: start }, end: { date: shiftDay(end, 1) } };
  }
  const from = DAY_TIME.exec(start);
  const to = DAY_TIME.exec(end);
  if (!from || !to) {
    throw new IntegrationError(
      "Give start and end both as dates (YYYY-MM-DD) for an all-day event, or both as YYYY-MM-DDTHH:MM:SS.",
      400,
    );
  }
  // A time without an offset is read on the calendar's own clock.
  const timeZone =
    from[4] && to[4]
      ? undefined
      : await calendarTimeZone(userId, calendarId, signal);
  const time = ([, day, clock, seconds = ":00", offset]: RegExpExecArray) =>
    offset
      ? { dateTime: `${day}T${clock}${seconds}${offset}` }
      : { dateTime: `${day}T${clock}${seconds}`, timeZone };
  return { start: time(from), end: time(to) };
}

export async function createCalendarEvent(
  userId: string,
  input: {
    calendarId: string;
    title: string;
    start: string;
    end: string;
    location?: string;
    description?: string;
    guests: string[];
  },
  signal?: AbortSignal,
): Promise<CalendarEventOutput> {
  const times = await eventTimes(
    userId,
    input.calendarId,
    input.start,
    input.end,
    signal,
  );
  const created = await calendarRequest<ApiEvent>(
    userId,
    eventsPath(input.calendarId),
    {
      body: {
        summary: input.title,
        ...times,
        ...(input.location ? { location: input.location } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.guests.length > 0
          ? { attendees: input.guests.map((email) => ({ email })) }
          : {}),
      },
      signal,
    },
  );
  return {
    account: account(userId),
    calendarId: input.calendarId,
    event: toEvent(created),
  };
}

export async function updateCalendarEvent(
  userId: string,
  input: {
    calendarId: string;
    eventId: string;
    title?: string;
    start?: string;
    end?: string;
    location?: string;
    description?: string;
    guests?: string[];
  },
  signal?: AbortSignal,
): Promise<CalendarEventOutput> {
  if ((input.start === undefined) !== (input.end === undefined)) {
    throw new IntegrationError(
      "Give both start and end to move an event.",
      400,
    );
  }
  const changes: Record<string, unknown> = {
    ...(input.title !== undefined ? { summary: input.title } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
  };
  if (input.start !== undefined && input.end !== undefined) {
    Object.assign(
      changes,
      await eventTimes(userId, input.calendarId, input.start, input.end, signal),
    );
  }
  if (input.guests !== undefined) {
    // Guests who stay keep the answer they already gave.
    const current = await calendarRequest<ApiEvent>(
      userId,
      eventsPath(input.calendarId, input.eventId),
      { signal },
    );
    const invited = new Map(
      (current.attendees ?? []).map((attendee) => [
        attendee.email?.toLowerCase(),
        attendee,
      ]),
    );
    changes.attendees = input.guests.map(
      (email) => invited.get(email.toLowerCase()) ?? { email },
    );
  }
  if (Object.keys(changes).length === 0) {
    throw new IntegrationError("Name at least one thing to change.", 400);
  }

  const updated = await calendarRequest<ApiEvent>(
    userId,
    eventsPath(input.calendarId, input.eventId),
    { method: "PATCH", body: changes, signal },
  );
  return {
    account: account(userId),
    calendarId: input.calendarId,
    event: toEvent(updated),
  };
}

export async function deleteCalendarEvent(
  userId: string,
  input: { calendarId: string; eventId: string },
  signal?: AbortSignal,
): Promise<CalendarEventOutput> {
  // Read first, so the result can say what was deleted.
  const event = await calendarRequest<ApiEvent>(
    userId,
    eventsPath(input.calendarId, input.eventId),
    { signal },
  );
  await calendarRequest<void>(
    userId,
    eventsPath(input.calendarId, input.eventId),
    { method: "DELETE", signal },
  );
  return {
    account: account(userId),
    calendarId: input.calendarId,
    event: toEvent(event),
  };
}
