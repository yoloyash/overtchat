import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { watchWindowsServiceStop, windowsServiceDirectory, windowsServiceLauncher, windowsTaskName } from "./windows-service.js";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("quotes executable and config paths without persisting unrelated secrets", () => {
  const script = windowsServiceLauncher(["C:\\A & B's\\connector.exe", "service-run"], {
    PATH: "C:\\custom bin",
    OVERTCHAT_CONNECTOR_CONFIG: "C:\\A & B's\\connector.json",
    ANTHROPIC_API_KEY: "do-not-persist",
  });
  expect(script).toContain("& 'C:\\A & B''s\\connector.exe' 'service-run'");
  expect(script).toContain("$env:OVERTCHAT_CONNECTOR_CONFIG = 'C:\\A & B''s\\connector.json'");
  expect(script).toContain("GetEnvironmentVariable('Path','User')");
  expect(script).not.toContain("do-not-persist");
});

it("restarts a failed connector until a graceful stop or disabled task", () => {
  const script = windowsServiceLauncher(["C:\\connector.exe", "service-run"], {}, "OvertChat Connector test's");
  expect(script).toContain("while ($true) {");
  expect(script).toContain("& 'C:\\connector.exe' 'service-run'\n  $code = $LASTEXITCODE\n  if ($code -eq 0) { exit 0 }");
  expect(script).toContain("if (!$folder.GetTask('OvertChat Connector test''s').Enabled) { exit $code }");
  expect(script).toContain("$delay = [Math]::Min($delay * 2, 60)");
});

it("separates scheduled tasks for isolated connector configurations", () => {
  vi.stubEnv("OVERTCHAT_CONNECTOR_CONFIG", path.join(os.tmpdir(), "first", "connector.json"));
  const first = windowsTaskName();
  vi.stubEnv("OVERTCHAT_CONNECTOR_CONFIG", path.join(os.tmpdir(), "second", "connector.json"));
  expect(windowsTaskName()).not.toBe(first);
});

it("ignores stale stop requests and stops only the current service instance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "connector-stop-"));
  vi.stubEnv("OVERTCHAT_CONNECTOR_CONFIG", path.join(directory, "connector.json"));
  const stop = vi.fn(async () => {});
  const cleanup = await watchWindowsServiceStop(stop);
  try {
    const service = windowsServiceDirectory();
    const state = JSON.parse(await readFile(path.join(service, "running.json"), "utf8")) as { nonce: string };
    await writeFile(path.join(service, "stop.json"), JSON.stringify({ nonce: "previous-instance" }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(stop).not.toHaveBeenCalled();
    await writeFile(path.join(service, "stop.json"), JSON.stringify({ nonce: state.nonce }));
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    await cleanup();
    await expect(readFile(path.join(service, "running.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await cleanup(); await rm(directory, { recursive: true, force: true }); }
});
