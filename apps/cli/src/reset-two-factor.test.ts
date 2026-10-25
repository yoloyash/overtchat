import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { text } from "@clack/prompts";
import { readInstallationConfig, readInstallationSecrets } from "./config.js";
import { verifyConnection } from "./connection-check.js";
import { resetTwoFactor } from "./reset-two-factor.js";

vi.mock("@clack/prompts", () => ({
  isCancel: (value: unknown) => typeof value === "symbol",
  text: vi.fn(),
}));
vi.mock("./config.js", () => ({
  readInstallationConfig: vi.fn(),
  readInstallationSecrets: vi.fn(),
}));
vi.mock("./connection-check.js", () => ({ verifyConnection: vi.fn() }));

const secret = "test-management-secret-not-for-logs";
const streams = [process.stdin, process.stdout];
const ttyDescriptors = streams.map((stream) =>
  Object.getOwnPropertyDescriptor(stream, "isTTY"),
);

beforeEach(() => {
  vi.resetAllMocks();
  for (const stream of streams)
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(readInstallationConfig).mockResolvedValue({
    appPort: 4718,
    instanceId: "owned-instance",
    publicUrl: "https://public.example",
  } as never);
  vi.mocked(readInstallationSecrets).mockResolvedValue({
    managementSecret: secret,
  });
  vi.mocked(verifyConnection).mockResolvedValue(null);
  vi.mocked(text).mockResolvedValue(" Admin@Example.com ");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status: true })),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  streams.forEach((stream, index) => {
    const descriptor = ttyDescriptors[index];
    if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
    else Reflect.deleteProperty(stream, "isTTY");
  });
});

describe("operator two-factor recovery", () => {
  it("sends the email to the verified local installation", async () => {
    await resetTwoFactor();
    expect(verifyConnection).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "http://127.0.0.1:4718/api/internal/management/two-factor-reset",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({ Authorization: `Bearer ${secret}` }),
        body: JSON.stringify({ email: "admin@example.com" }),
      }),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Two-factor removed"),
    );
  });

  it("does nothing when the prompt is canceled", async () => {
    vi.mocked(text).mockResolvedValue(Symbol("cancel") as never);
    await resetTwoFactor();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires an interactive terminal", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    await expect(resetTwoFactor()).rejects.toThrow(
      "Two-factor recovery requires an interactive terminal.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [409, "doesn't use two-factor"],
    [404, "not found"],
    [500, "Two-factor recovery failed (HTTP 500)"],
  ])("explains HTTP %i", async (status, message) => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status }));
    const failure = await resetTwoFactor().catch((error: Error) => error);
    expect(String(failure)).toContain(message);
    expect(String(failure)).not.toContain(secret);
    expect(console.log).not.toHaveBeenCalled();
  });
});
