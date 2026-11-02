import { afterEach, expect, it, vi } from "vitest";
import { initialSetupLink } from "./initial-setup.js";

const secret = "test-management-secret-123456789012345";
const code = "ABCD-EFGH-JKMN";
const config = { appPort: 4718, instanceId: "fixture", publicUrl: "https://chat.example.com" };
const ping = { ok: true, name: "overtchat", instanceId: "fixture" };
afterEach(() => vi.unstubAllGlobals());

it("retrieves over verified loopback and prints a public fragment link", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json(ping))
    .mockResolvedValueOnce(Response.json({ required: true, code }));
  vi.stubGlobal("fetch", fetcher);
  expect(await initialSetupLink(config, secret)).toBe(`https://chat.example.com/signup#setup=${code}`);
  expect(String(fetcher.mock.calls[0][0])).toContain(`http://127.0.0.1:${config.appPort}/api/ping`);
  expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
  expect(fetcher.mock.calls[1]).toEqual([
    `http://127.0.0.1:${config.appPort}/api/internal/management/setup`,
    expect.objectContaining({ redirect: "error", headers: { Authorization: `Bearer ${secret}` } }),
  ]);
});

it("never sends management credentials to a different installation", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ...ping, instanceId: "other" }));
  vi.stubGlobal("fetch", fetcher);
  await expect(initialSetupLink(config, secret)).rejects.toThrow("Cannot retrieve");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  Response.json({ required: false, code: null }),
  new Response(null, { status: 404 }),
])("omits links after setup or for older servers", async (response) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(ping)).mockResolvedValueOnce(response));
  expect(await initialSetupLink(config, secret)).toBeNull();
});

it.each([
  Response.json({ required: true, code: "invalid#value" }),
  Response.json({}),
  new Response(null, { status: 401 }),
])("rejects failed or malformed setup responses", async (response) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(ping)).mockResolvedValueOnce(response));
  await expect(initialSetupLink(config, secret)).rejects.toThrow();
});

it("does not send an absent management secret", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(ping));
  vi.stubGlobal("fetch", fetcher);
  await expect(initialSetupLink(config, undefined)).rejects.toThrow("management secret");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
