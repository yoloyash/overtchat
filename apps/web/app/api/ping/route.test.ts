import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "@/lib/version";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/ping", () => {
  it("reports the same release version shown in the app", async () => {
    vi.stubEnv("OVERTCHAT_INSTANCE_ID", "");
    const response = GET(new Request("http://localhost/api/ping"));

    expect(await response.json()).toEqual({
      ok: true,
      name: "overtchat",
      version: APP_VERSION,
    });
  });
  it("includes only the public instance identifier for a managed installation", async () => {
    vi.stubEnv("OVERTCHAT_INSTANCE_ID", "test-installation");
    vi.stubEnv("OVERTCHAT_MANAGEMENT_SECRET", "must-not-be-returned");
    const response = GET(new Request("http://localhost/api/ping"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      name: "overtchat",
      version: APP_VERSION,
      instanceId: "test-installation",
    });
  });
});
