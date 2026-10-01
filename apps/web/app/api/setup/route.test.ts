import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userCount: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({ from: async () => [{ n: mocks.userCount }] }),
  },
}));

import { GET } from "./route";

describe("GET /api/setup", () => {
  beforeEach(() => {
    mocks.userCount = 0;
  });

  it("requires setup before the first account exists", async () => {
    const response = await GET();

    expect(await response.json()).toEqual({ required: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not require setup once an account exists", async () => {
    mocks.userCount = 1;

    expect(await (await GET()).json()).toEqual({ required: false });
  });
});
