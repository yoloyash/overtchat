function cached<T>(cache: Map<string, T>, locale: string, create: () => T): T {
  let formatter = cache.get(locale);
  if (!formatter) {
    formatter = create();
    cache.set(locale, formatter);
  }
  return formatter;
}

const compactNumbers = new Map<string, Intl.NumberFormat>();
const exactNumbers = new Map<string, Intl.NumberFormat>();
const localDates = new Map<string, Intl.DateTimeFormat>();
const utcDates = new Map<string, Intl.DateTimeFormat>();
const utcMonths = new Map<string, Intl.DateTimeFormat>();

export function formatCompact(value: number, locale: string): string {
  return cached(
    compactNumbers,
    locale,
    () =>
      new Intl.NumberFormat(locale, {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
  ).format(value);
}

export function formatExact(value: number, locale: string): string {
  return cached(exactNumbers, locale, () => new Intl.NumberFormat(locale)).format(
    value,
  );
}

export function formatDate(value: number, locale: string): string {
  return cached(
    localDates,
    locale,
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
  ).format(value);
}

export function formatUtcDate(value: Date, locale: string): string {
  return cached(
    utcDates,
    locale,
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }),
  ).format(value);
}

export function formatUtcMonth(value: Date, locale: string): string {
  return cached(
    utcMonths,
    locale,
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        timeZone: "UTC",
      }),
  ).format(value);
}
