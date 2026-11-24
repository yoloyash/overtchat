import { describe, expect, it } from "vitest";
import { sameItems, sameMap, sameSet, shallowEqual } from "./equal";

describe("content equality", () => {
  it("treats a copy with the same values as equal, one level down", () => {
    const output = { rows: [1] };
    expect(shallowEqual({ type: "tool", output }, { type: "tool", output })).toBe(true);
    expect(shallowEqual({ type: "text", text: "a" }, { type: "text", text: "ab" })).toBe(false);
    expect(shallowEqual({ output: { rows: [1] } }, { output: { rows: [1] } })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(shallowEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(shallowEqual(null, {})).toBe(false);
  });

  it("compares lists item by item", () => {
    const part = { type: "reasoning", text: "x" };
    expect(sameItems([part, { ...part }], [{ ...part }, part])).toBe(true);
    expect(sameItems([part], [part, part])).toBe(false);
    expect(sameItems([part], [{ ...part, text: "xy" }])).toBe(false);
  });

  it("compares sets and maps by content", () => {
    expect(sameSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameSet(new Set(["a"]), new Set(["b"]))).toBe(false);
    expect(sameMap(new Map([["k", { id: 1 }]]), new Map([["k", { id: 1 }]]))).toBe(true);
    expect(sameMap(new Map([["k", { id: 1 }]]), new Map([["k", { id: 2 }]]))).toBe(false);
    expect(sameMap(new Map([["k", 1]]), new Map([["j", 1]]))).toBe(false);
  });
});
