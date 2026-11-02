import { createServer } from "node:net";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runMigrations: vi.fn(),
  ensureServerCapabilityConfigs: vi.fn(),
  sweepOrphanedUploads: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/migrate", () => ({ runMigrations: mocks.runMigrations }));
vi.mock("@/lib/db/initialSetup", () => ({ getSetupCode: () => null }));
vi.mock("@/lib/db/serverCapabilities", () => ({ ensureServerCapabilityConfigs: mocks.ensureServerCapabilityConfigs }));
vi.mock("@/lib/db/uploads", () => ({ sweepOrphanedUploads: mocks.sweepOrphanedUploads }));
vi.mock("@/lib/agents/terminal/server", async () => {
  const { TerminalRelay } = await import("./relay");
  return { terminalRelay: new TerminalRelay(() => null) };
});
import { register } from "../../../instrumentation";
import { terminalRelay } from "@/lib/agents/terminal/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("continues web startup and maintenance when the optional terminal port is occupied", async () => {
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const address = occupied.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("OVERTCHAT_TERMINAL_RELAY_PORT", String(address.port));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(register()).resolves.toBeUndefined();
    expect(mocks.runMigrations).toHaveBeenCalledOnce();
    expect(mocks.ensureServerCapabilityConfigs).toHaveBeenCalledOnce();
    expect(mocks.sweepOrphanedUploads).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "[terminal-relay] Workspace terminals unavailable:",
      expect.objectContaining({ code: "EADDRINUSE" }),
    );
    expect(terminalRelay.isOnline("connector")).toBe(false);
  } finally {
    await terminalRelay.close();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});

it("still rejects startup when a required database migration fails", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  mocks.runMigrations.mockImplementationOnce(() => { throw new Error("migration failed"); });
  await expect(register()).rejects.toThrow("migration failed");
  expect(mocks.sweepOrphanedUploads).not.toHaveBeenCalled();
});
