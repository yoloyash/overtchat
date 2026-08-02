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
