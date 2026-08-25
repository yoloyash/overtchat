import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("app update check", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("compares stable semantic versions", async () => {
    const { isNewerVersion } = await import("./update-check");

    expect(isNewerVersion("0.16.0", "0.17.0")).toBe(true);
    expect(isNewerVersion("0.16.0", "1.0.0")).toBe(true);
    expect(isNewerVersion("0.16.0", "0.16.1")).toBe(true);
    expect(isNewerVersion("0.16.0", "0.16.0")).toBe(false);
    expect(isNewerVersion("0.16.0", "0.15.9")).toBe(false);
    expect(isNewerVersion("development", "0.17.0")).toBe(false);
    expect(isNewerVersion("0.16.0", "not-a-version")).toBe(false);
  });

  it("fetches the current public manifest for every check", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ format: 1, appVersion: "99.0.0" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getAppUpdateStatus } = await import("./update-check");

    await expect(getAppUpdateStatus()).resolves.toMatchObject({
      latestVersion: "99.0.0",
      updateAvailable: true,
    });
    await getAppUpdateStatus();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://overtchat.com/install-manifest.json",
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("does not retain an unavailable manifest result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ format: 1, appVersion: "99.0.0" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getAppUpdateStatus } = await import("./update-check");

    await expect(getAppUpdateStatus()).resolves.toMatchObject({
      latestVersion: null,
      updateAvailable: false,
    });
    await expect(getAppUpdateStatus()).resolves.toMatchObject({
      latestVersion: "99.0.0",
      updateAvailable: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not make a request when checks are disabled", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISABLE_UPDATE_CHECK", "true");
    const { getAppUpdateStatus } = await import("./update-check");

    await expect(getAppUpdateStatus()).resolves.toMatchObject({
      latestVersion: null,
      updateAvailable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
