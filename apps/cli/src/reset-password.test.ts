import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { password, text } from "@clack/prompts";
import { readInstallationConfig, readInstallationSecrets } from "./config.js";
import { verifyConnection } from "./connection-check.js";
import { resetPassword } from "./reset-password.js";

vi.mock("@clack/prompts", () => ({
  isCancel: (value: unknown) => typeof value === "symbol",
  text: vi.fn(),
  password: vi.fn(),
}));
vi.mock("./config.js", () => ({
  readInstallationConfig: vi.fn(),
  readInstallationSecrets: vi.fn(),
}));
vi.mock("./connection-check.js", () => ({ verifyConnection: vi.fn() }));

const secret = "test-management-secret-not-for-logs";
const replacement = "test-replacement-password";
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
  vi.mocked(text).mockResolvedValue(" Member@Example.com ");
  vi.mocked(password)
    .mockResolvedValueOnce(replacement)
    .mockResolvedValueOnce(replacement);
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

describe("operator password recovery", () => {
  it("uses only the verified local installation and sends masked prompt answers in the body", async () => {
    await resetPassword();
    expect(verifyConnection).toHaveBeenCalledTimes(2);
    expect(verifyConnection).toHaveBeenCalledWith(
      "http://127.0.0.1:4718",
      "owned-instance",
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "http://127.0.0.1:4718/api/internal/management/password-reset",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "member@example.com",
          newPassword: replacement,
        }),
      }),
    );
    for (const call of vi.mocked(password).mock.calls)
      expect(call[0]).toMatchObject({ mask: "•" });
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
      secret,
    );
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
      replacement,
    );
  });

  it("refuses noninteractive use before loading secrets", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    await expect(resetPassword()).rejects.toThrow("interactive terminal");
    expect(readInstallationSecrets).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires managed state", async () => {
    vi.mocked(readInstallationConfig).mockResolvedValue(null);
    await expect(resetPassword()).rejects.toThrow("No managed installation");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never sends credentials to a different installation on the saved port", async () => {
    vi.mocked(verifyConnection).mockResolvedValue("Wrong installation.");
    await expect(resetPassword()).rejects.toThrow("Wrong installation");
    expect(readInstallationSecrets).not.toHaveBeenCalled();
    expect(password).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rechecks the installation after prompting", async () => {
    vi.mocked(verifyConnection)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("Installation changed.");
    await expect(resetPassword()).rejects.toThrow("Installation changed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a usable management secret", async () => {
    vi.mocked(readInstallationSecrets).mockResolvedValue({
      managementSecret: "short",
    });
    await expect(resetPassword()).rejects.toThrow("no management secret");
    expect(password).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["email", "password", "confirmation"])(
    "does not mutate after cancelling %s",
    async (step) => {
      if (step === "email") vi.mocked(text).mockResolvedValue(Symbol("cancel"));
      else {
        vi.mocked(password).mockReset();
        if (step === "confirmation")
          vi.mocked(password).mockResolvedValueOnce(replacement);
        vi.mocked(password).mockResolvedValueOnce(Symbol("cancel"));
      }
      await resetPassword();
      expect(fetch).not.toHaveBeenCalled();
      expect(console.log).not.toHaveBeenCalled();
    },
  );

  it.each([400, 401, 404, 409, 500])(
    "does not report success or expose response bodies on HTTP %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(secret + replacement, { status })),
      );
      const failure = await resetPassword().catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain(secret);
      expect(String(failure)).not.toContain(replacement);
      expect(console.log).not.toHaveBeenCalled();
    },
  );

  it("does not claim success for an unexpected server response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: false })),
    );
    await expect(resetPassword()).rejects.toThrow("did not confirm");
    expect(console.log).not.toHaveBeenCalled();
  });
});
