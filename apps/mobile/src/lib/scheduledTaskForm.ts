import { formatTaskTime, localDate } from "@overtchat/shared";

/**
 * The choices the task form's pickers offer. A value a task already holds is
 * always among them, wherever it was set, so opening a task never changes it.
 */
export type FormOption = { value: string; label: string };

const two = (value: number) => String(value).padStart(2, "0");

function withCurrent(
  options: FormOption[],
  current: string,
  label: (value: string) => string | null,
): FormOption[] {
  if (options.some((option) => option.value === current)) return options;
  const text = label(current);
  if (text === null) return options;
  return [...options, { value: current, label: text }].sort((a, b) =>
    a.value.localeCompare(b.value),
  );
}

/** Times of day a quarter of an hour apart, as 24-hour HH:MM. */
export function timeOptions(current: string, locale?: string): FormOption[] {
  const options: FormOption[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 15, 30, 45]) {
      options.push({
        value: `${two(hour)}:${two(minute)}`,
        label: formatTaskTime(hour, minute, locale),
      });
    }
  }
  return withCurrent(options, current, (value) => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
    return match ? formatTaskTime(Number(match[1]), Number(match[2]), locale) : null;
  });
}

/** Minutes past the hour, five apart. */
export function minuteOptions(current: number): FormOption[] {
  const options = Array.from({ length: 12 }, (_, index) => ({
    value: two(index * 5),
    label: `:${two(index * 5)}`,
  }));
  return withCurrent(options, two(current), (value) => `:${value}`);
}

export function dayOfMonthOptions(): FormOption[] {
  return Array.from({ length: 31 }, (_, index) => ({
    value: two(index + 1),
    label: String(index + 1),
  }));
}

function dateLabel(value: string, locale?: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

/** Today and the days after it, as YYYY-MM-DD. */
export function dateOptions(
  current: string,
  now = new Date(),
  days = 90,
  locale?: string,
): FormOption[] {
  const options: FormOption[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const value = localDate(now, offset);
    options.push({ value, label: dateLabel(value, locale) ?? value });
  }
  return withCurrent(options, current, (value) => dateLabel(value, locale));
}
