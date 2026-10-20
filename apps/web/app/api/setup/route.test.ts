import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ code: "ABCD-EFGH-JKMN" as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/initialSetup", () => ({
  getSetupCode: () => mocks.code,
}));

import { GET } from "./route";

describe("GET /api/setup", () => {
  beforeEach(() => {
    mocks.code = "ABCD-EFGH-JKMN";
  });

  it("requires setup before the first account exists", async () => {
    const response = await GET();

    expect(await response.json()).toEqual({ required: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not require setup once bootstrap is closed", async () => {
    mocks.code = null;

    expect(await (await GET()).json()).toEqual({ required: false });
  });
});
