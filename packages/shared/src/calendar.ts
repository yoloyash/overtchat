import { conversationUsesSkill } from "./skills";
import type { ToolState } from "./tools";

/** Google Calendar tool names in deterministic provider order. */
export const CALENDAR_TOOL_NAMES = [
  "calendar_list_calendars",
  "calendar_list_events",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
] as const;
export type CalendarToolName = (typeof CALENDAR_TOOL_NAMES)[number];

export interface CalendarSummary {
  id: string;
  name: string;
  /** The user's own calendar, which "primary" also names. */
  primary: boolean;
  /** Whether events can be added to it or changed on it. */
  canEdit: boolean;
  timeZone?: string;
}

export interface CalendarListOutput {
  calendars: CalendarSummary[];
}

export interface CalendarGuest {
  email: string;
  name?: string;
  response: "accepted" | "declined" | "tentative" | "needsAction";
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO 8601 with an offset, or YYYY-MM-DD for an all-day event. */
  start: string;
  /** For an all-day event, its last day. */
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  /** Everyone invited other than the user. */
  guests?: CalendarGuest[];
  /** Guests left out of `guests` because the list was long. */
  moreGuests?: number;
  /** Who organizes the event, when that is not the user. */
  organizer?: string;
  meetingLink?: string;
  /** One occurrence of an event that repeats. */
  recurring?: boolean;
  /** Left out for an ordinary, confirmed event. */
  status?: "tentative" | "cancelled";
  /** Opens the event in Google Calendar. */
  link?: string;
}

export interface CalendarEventsOutput {
  /** The Google account the calendar belongs to. */
  account: string;
  calendarId: string;
  /** The calendar's time zone, which event times are given in. */
  timeZone: string;
  /** The time of the request, in that time zone. */
  now: string;
  /** Earliest first. */
  events: CalendarEvent[];
  /** More events fall in the range than were returned. */
  hasMore: boolean;
}

/** What creating, changing or deleting an event returns. */
export interface CalendarEventOutput {
  account: string;
  calendarId: string;
  event: CalendarEvent;
}

export type CalendarToolPart = {
  type: `tool-${CalendarToolName}`;
  toolCallId: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const CALENDAR_PART_TYPES: ReadonlySet<string> = new Set(
  CALENDAR_TOOL_NAMES.map((name) => `tool-${name}`),
);

export function isCalendarToolPart(part: {
  type: string;
}): part is CalendarToolPart {
  return CALENDAR_PART_TYPES.has(part.type);
}

/** What the user types to turn Google Calendar on in one chat. */
export const CALENDAR_COMMAND = "/calendar";

export const CALENDAR_COMMAND_PATTERN = /^\s*\/calendar(?:\s|$)/i;

/**
 * Whether a conversation has loaded Google Calendar: the user asked for it,
 * a message opens with the command typed out, a model viewed the skill, or
 * a model already used the calendar tools. A chat keeps it once it has it.
 */
export function conversationUsesCalendar(
  messages: readonly {
    role: string;
    metadata?: unknown;
    parts: readonly { type: string; text?: unknown }[];
  }[],
): boolean {
  return conversationUsesSkill(messages, {
    id: "calendar",
    command: CALENDAR_COMMAND_PATTERN,
    isToolPart: isCalendarToolPart,
  });
}

/** One event in a calendar step. */
export interface CalendarEventRow {
  title: string;
  start?: string;
  end?: string;
  allDay: boolean;
  location?: string;
  /** How many other people are invited. */
  guests: number;
  /** The event was deleted or cancelled. */
  gone: boolean;
  /** Opens the event in Google Calendar. */
  href?: string;
}

/** What web and mobile show for one calendar step, without descriptions. */
export interface CalendarToolDisplay {
  action: "calendars" | "events" | "create" | "update" | "delete";
  status: "running" | "done" | "error";
  title: string;
  /** What was searched for. */
  detail?: string;
  /** A count, shown beside the title. */
  note?: string;
  rows: CalendarEventRow[];
  error?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function list(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const entry = record(item);
    if (entry) records.push(entry);
  }
  return records;
}

function count(total: number, noun: string, more = false): string {
  if (total === 0) return `No ${noun}s`;
  return `${total}${more ? "+" : ""} ${noun}${total === 1 && !more ? "" : "s"}`;
}

/**
 * Google Calendar opens the first signed-in account unless told which, so an
 * event is linked only when its account is known and the link is Google's.
 */
function eventUrl(
  account: string | undefined,
  link: string | undefined,
): string | undefined {
  if (!account || !link) return undefined;
  try {
    const url = new URL(link);
    if (
      url.protocol !== "https:" ||
      !["www.google.com", "calendar.google.com"].includes(url.hostname)
    ) {
      return undefined;
    }
    url.searchParams.set("authuser", account);
    return url.toString();
  } catch {
    return undefined;
  }
}

function eventRow(
  event: Record<string, unknown> | undefined,
  account: string | undefined,
  deleted = false,
): CalendarEventRow[] {
  if (!event) return [];
  const gone = deleted || event.status === "cancelled";
  const more = typeof event.moreGuests === "number" ? event.moreGuests : 0;
  return [
    {
      title: text(event.title) ?? "(no title)",
      start: text(event.start),
      end: text(event.end),
      allDay: event.allDay === true,
      location: text(event.location),
      guests: list(event.guests).length + more,
      gone,
      href: gone ? undefined : eventUrl(account, text(event.link)),
    },
  ];
}

const TITLES: Record<
  CalendarToolDisplay["action"],
  [running: string, done: string]
> = {
  calendars: ["Listing calendars", "Listed calendars"],
  events: ["Checking calendar", "Checked calendar"],
  create: ["Adding event", "Added event to calendar"],
  update: ["Changing event", "Changed event"],
  delete: ["Deleting event", "Deleted event"],
};

/**
 * Projects a saved or streaming calendar tool call for display. It reads the
 * part defensively: saved history can predate the current output shape.
 */
export function describeCalendarToolPart(
  part: CalendarToolPart,
): CalendarToolDisplay {
  const action =
    part.type === "tool-calendar_list_calendars"
      ? "calendars"
      : part.type === "tool-calendar_list_events"
        ? "events"
        : part.type === "tool-calendar_create_event"
          ? "create"
          : part.type === "tool-calendar_update_event"
            ? "update"
            : "delete";
  const status =
    part.state === "output-error"
      ? "error"
      : part.state === "output-available"
        ? "done"
        : "running";
  const input = record(part.input);
  const output = status === "done" ? record(part.output) : undefined;
  const base = {
    action,
    status,
    title: TITLES[action][status === "running" ? 0 : 1],
    error:
      status === "error"
        ? (text(part.errorText) ?? "Google Calendar request failed")
        : undefined,
  } as const;
  const account = text(output?.account);

  if (action === "calendars") {
    return {
      ...base,
      note: output ? count(list(output.calendars).length, "calendar") : undefined,
      rows: [],
    };
  }

  if (action === "events") {
    const events = list(output?.events);
    return {
      ...base,
      detail: text(input?.query),
      note: output
        ? count(events.length, "event", output.hasMore === true)
        : undefined,
      rows: events.flatMap((event) => eventRow(event, account)),
    };
  }

  return {
    ...base,
    rows: eventRow(record(output?.event), account, action === "delete"),
  };
}

/** The activity timeline's one-line summary while or after a calendar step runs. */
export function calendarActivityLabel(
  part: CalendarToolPart,
  active: boolean,
): string {
  const display = describeCalendarToolPart(part);
  if (active) return `${TITLES[display.action][0]}…`;
  if (display.status === "error") return "Google Calendar request failed";
  if (display.status === "running") {
    return "Google Calendar request did not complete";
  }
  return display.title;
}

const CLOCK_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

/**
 * A day or a time as the calendar's own clock shows it. The offset is left
 * aside on purpose: a model reads and reports these times as written, so the
 * step shows the same hour the answer names, wherever the viewer is.
 */
function clockTime(value: string | undefined): Date | null {
  const match = value ? CLOCK_TIME.exec(value) : null;
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0"] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * When an event happens, on the calendar's clock and in the viewer's language:
 * "Fri, Nov 6 · 10:00 AM – 10:30 AM", "Fri, Nov 6" for a whole day.
 */
export function formatCalendarEventTime(
  event: Pick<CalendarEventRow, "start" | "end" | "allDay">,
  locale?: string,
): string {
  const start = clockTime(event.start);
  if (!start) return "";
  const end = clockTime(event.end);
  const day = (date: Date) =>
    date.toLocaleDateString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  const time = (date: Date) =>
    date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const sameDay = !end || start.toDateString() === end.toDateString();

  if (event.allDay) {
    return sameDay ? day(start) : `${day(start)} – ${day(end)}`;
  }
  if (!end) return `${day(start)} · ${time(start)}`;
  return sameDay
    ? `${day(start)} · ${time(start)} – ${time(end)}`
    : `${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`;
}
