import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/nativeSignIn", () => ({ redeemNativeSignInCode: vi.fn() }));

import { createNativeSignInStartLimiter } from "./native-sign-in";

describe("starting an app's sign-in", () => {
  it("shares one budget across the server and refills it each minute", () => {
    let time = 1_000_000;
    const limit = createNativeSignInStartLimiter(() => time);

    for (let started = 0; started < 60; started++) expect(limit()).toBeNull();
    expect(limit()).toBe(60);
    time += 45_000;
    expect(limit()).toBe(15);

    time += 15_000;
    expect(limit()).toBeNull();
  });
});
