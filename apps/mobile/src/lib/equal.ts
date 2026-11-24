import { useState } from "react";

/** Whether two values are identical, or hold identical values under the same keys or indexes. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Whether two lists hold items that are equal one level down, in the same order. */
export function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a === b || (a.length === b.length && a.every((item, index) => shallowEqual(item, b[index])));
}

export function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/** Whether two maps hold the same keys with values that are equal one level down. */
export function sameMap<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (!b.has(key) || !shallowEqual(value, b.get(key))) return false;
  }
  return true;
}

/**
 * Keeps returning the earlier value while a newly computed one holds the same
 * content, so components that receive it are not asked to render again.
 */
export function useStable<T>(value: T, same: (earlier: T, next: T) => boolean): T {
  const [stable, setStable] = useState(value);
  if (stable === value || same(stable, value)) return stable;
  setStable(value);
  return value;
}
