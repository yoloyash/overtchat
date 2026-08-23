import { describe, expect, it } from "vitest";
import { APP_VERSION } from "@/lib/version";
import { GET } from "./route";

describe("GET /api/ping", () => {
  it("reports the same release version shown in the app", async () => {
    const response = GET(new Request("http://localhost/api/ping"));

    expect(await response.json()).toEqual({
      ok: true,
      name: "overtchat",
      version: APP_VERSION,
    });
  });
});
