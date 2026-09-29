import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installationLogPath, logInstallation, protectInstallationSecrets, withInstallationLog } from "./install-log.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-install-log-"));
  vi.stubEnv("OVERTCHAT_CONFIG_DIR", directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

it("retains failed-phase diagnostics privately without credentials", async () => {
  const operation = withInstallationLog("setup", async () => {
    protectInstallationSecrets("fixture-management-secret");
    logInstallation("Starting Agent Connector service");
    throw new AggregateError([
      new Error("request fixture-management-secret failed"),
      new Error('token="oct_test.abc123" password=private-value Authorization: Bearer other-token'),
    ], "Service startup failed");
  });
  await expect(operation).rejects.toThrow("overtchat logs install");
  const log = await readFile(installationLogPath(), "utf8");
  expect(log).toContain("Starting Agent Connector service");
  expect(log).toContain("Service startup failed");
  for (const secret of ["fixture-management-secret", "oct_test.abc123", "private-value", "other-token"])
    expect(log).not.toContain(secret);
  expect((await stat(installationLogPath())).mode & 0o777).toBe(0o600);
});

it("rotates a large previous log and keeps records from subsequent attempts", async () => {
  await writeFile(installationLogPath(), "x".repeat(5 * 1024 * 1024 + 1));
  await withInstallationLog("setup", async () => logInstallation("first attempt"));
  await withInstallationLog("update", async () => logInstallation("second attempt"));
  const log = await readFile(installationLogPath(), "utf8");
  expect(log).toContain("first attempt");
  expect(log).toContain("second attempt");
  expect((await stat(`${installationLogPath()}.previous`)).size).toBeGreaterThan(5 * 1024 * 1024);
});
