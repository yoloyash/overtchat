import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createShareReadLimiter } from "./share-rate-limit";

describe("public share read budgets", () => {
  it("throttles repeated reads with retry headers, isolates files, and recovers", () => {
    let time = 0;
    const limit = createShareReadLimiter(() => time);
    for (let i = 0; i < 120; i++) expect(limit("link", "page")).toBeNull();
    const response = limit("link", "page")!;
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(limit("other", "page")).toBeNull();
    for (let i = 0; i < 600; i++) expect(limit("link", "file")).toBeNull();
    expect(limit("link", "file")?.status).toBe(429);
    time = 59_001;
    expect(limit("link", "page")?.headers.get("retry-after")).toBe("1");
    time = 60_000;
    expect(limit("link", "page")).toBeNull();
    expect(limit("link", "file")).toBeNull();
  });

  it("bounds total reads even when an attacker rotates tokens, and bounds bucket memory", () => {
    let time = 0;
    const limit = createShareReadLimiter(() => time);
    for (let i = 0; i < 1200; i++)
      expect(limit(`token-${i}`, "page")).toBeNull();
    expect(limit("fresh", "page")?.status).toBe(429);
    // Separate file budget, but the total number of live buckets stays bounded.
    for (let i = 0; i < 2894; i++)
      expect(limit(`file-${i}`, "file")).toBeNull();
    expect(limit("another", "file")?.status).toBe(429);
    time = 60_000;
    expect(limit("fresh", "page")).toBeNull();
    expect(limit("another", "file")).toBeNull();
  });
});
