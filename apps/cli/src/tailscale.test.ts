import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkServeRoute,
  detectTailscale,
  removeServe,
  serveConflict,
  startServe,
} from "./tailscale.js";
import { commandExists, runCommand } from "./process.js";
vi.mock("./process.js", () => ({
  commandExists: vi.fn(),
  runCommand: vi.fn(),
}));
const route = {
  hostname: "server.example.ts.net",
  port: 443,
  target: "http://127.0.0.1:4718",
};
const configured = {
  TCP: { "443": { HTTPS: true } },
  Web: {
    "server.example.ts.net:443": { Handlers: { "/": { Proxy: route.target } } },
  },
};
function result(body: unknown, exitCode = 0) {
  return { stdout: JSON.stringify(body), stderr: "", exitCode };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(commandExists).mockResolvedValue(true);
});

describe("Tailscale readiness", () => {
  it("reports missing Tailscale without running or installing it", async () => {
    vi.mocked(commandExists).mockResolvedValue(false);
    expect((await detectTailscale()).problem).toContain("Tailscale not found");
    expect(runCommand).not.toHaveBeenCalled();
  });
  it.each([
    ["NeedsLogin", "sign-in"],
    ["NeedsMachineAuth", "approval"],
    ["Stopped", "disconnected"],
    ["NoState", "not ready"],
  ])("explains %s", async (BackendState, message) => {
    vi.mocked(runCommand).mockResolvedValue(result({ BackendState }));
    expect((await detectTailscale()).problem).toContain(message);
  });
  it("reports an unavailable daemon and offline devices", async () => {
    vi.mocked(runCommand).mockResolvedValue({
      stdout: "",
      stderr: "daemon unavailable",
      exitCode: 1,
    });
    expect((await detectTailscale()).problem).toContain("service is running");
    vi.mocked(runCommand).mockResolvedValue(
      result({ BackendState: "Running", Self: { Online: false } }),
    );
    expect((await detectTailscale()).problem).toContain("offline");
  });
  it("returns a normalized device hostname only when connected", async () => {
    vi.mocked(runCommand).mockResolvedValue(
      result({
        BackendState: "Running",
        Self: { DNSName: "server.example.ts.net.", Online: true },
      }),
    );
    expect(await detectTailscale()).toEqual({ hostname: route.hostname });
  });
});
describe("Tailscale Serve ownership", () => {
  it("accepts an unused port or its own exact existing route", () => {
    expect(serveConflict({}, route)).toBeUndefined();
    expect(serveConflict(configured, route, route)).toBeUndefined();
    expect(
      serveConflict(
        configured,
        { ...route, target: "http://127.0.0.1:4999" },
        route,
      ),
    ).toBeUndefined();
  });
  it("rejects other apps, foreground listeners, TCP listeners, and public Funnel", () => {
    expect(serveConflict(configured, route)).toContain("another application");
    expect(serveConflict({ TCP: { "443": {} } }, route)).toContain(
      "already in use",
    );
    expect(
      serveConflict({ Foreground: { session: configured } }, route),
    ).toContain("foreground");
    expect(
      serveConflict(
        { ...configured, AllowFunnel: { "server.example.ts.net:443": true } },
        route,
        route,
      ),
    ).toContain("Funnel");
  });
  it("checks again immediately before starting and never resets Serve", async () => {
    vi.mocked(runCommand)
      .mockResolvedValueOnce(result({}))
      .mockResolvedValueOnce(result({}))
      .mockResolvedValueOnce(result(configured));
    await startServe(route);
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "tailscale",
      ["serve", "--bg", "--yes", "--https=443", "--set-path=/", route.target],
      expect.any(Object),
    );
    expect(
      vi
        .mocked(runCommand)
        .mock.calls.some(([, args]) => args.includes("reset")),
    ).toBe(false);
  });
  it("does not mutate conflicting or unreadable state", async () => {
    vi.mocked(runCommand).mockResolvedValue(result(configured));
    await expect(startServe(route)).rejects.toThrow("another application");
    expect(runCommand).toHaveBeenCalledTimes(1);
    vi.mocked(runCommand).mockResolvedValue({
      stdout: "garbage",
      stderr: "",
      exitCode: 0,
    });
    await expect(checkServeRoute(route)).rejects.toThrow();
  });
  it("reports HTTPS enablement instructions on failure", async () => {
    vi.mocked(runCommand)
      .mockResolvedValueOnce(result({}))
      .mockResolvedValueOnce({
        stdout: "Enable HTTPS: https://login.tailscale.com/example",
        stderr: "",
        exitCode: 1,
      });
    await expect(startServe(route)).rejects.toThrow(
      "https://login.tailscale.com/example",
    );
  });
  it("removes only the recorded route and verifies removal", async () => {
    vi.mocked(runCommand)
      .mockResolvedValueOnce(result(configured))
      .mockResolvedValueOnce(result({}))
      .mockResolvedValueOnce(result({}));
    await removeServe(route);
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "tailscale",
      ["serve", "--bg", "--https=443", "--set-path=/", "off"],
      expect.any(Object),
    );
  });
  it("refuses to remove a route changed by someone else", async () => {
    vi.mocked(runCommand).mockResolvedValue(result(configured));
    await expect(
      removeServe({ ...route, target: "http://127.0.0.1:9999" }),
    ).rejects.toThrow("changed outside setup");
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});
