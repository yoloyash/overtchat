const compactNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const exactNumber = new Intl.NumberFormat();

export function formatCompact(value: number): string {
  return compactNumber.format(value);
}

export function formatExact(value: number): string {
  return exactNumber.format(value);
}

export function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

const utcDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const utcMonth = new Intl.DateTimeFormat(undefined, {
  month: "short",
  timeZone: "UTC",
});

export function formatUtcDate(value: Date): string {
  return utcDate.format(value);
}

export function formatUtcMonth(value: Date): string {
  return utcMonth.format(value);
}
