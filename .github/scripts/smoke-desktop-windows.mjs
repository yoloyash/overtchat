// Install the real NSIS packages and exercise the updater on a disposable Windows
// account. Refuse an existing OvertChat profile; never replace an operator install.
/* global window, fetch */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { inspect } from "node:util";
import { CLIENT_API_LEVEL } from "../../packages/shared/src/ping.ts";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const [installer, candidates, version] = process.argv.slice(2);
assert(installer && candidates && /^\d+\.\d+\.\d+$/.test(version),
  "Usage: node smoke-desktop-windows.mjs loopback-baseline-installer candidate-directory target-version");
assert.equal(process.platform, "win32");
assert.equal(process.arch, "x64");
assert(process.env.APPDATA, "Windows APPDATA is required");
const profile = path.join(process.env.APPDATA, "overtchat");
await assert.rejects(access(profile), { code: "ENOENT" }, "Use a disposable Windows account without an OvertChat profile");
const preflightStartedAt = Date.now();
const existing = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "$apps = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'overtchat*' }; if ($apps) { exit 1 }; if (Get-Process overtchat -ErrorAction SilentlyContinue) { exit 1 }; exit 0"], { encoding: "utf8", timeout: 15_000 });
if (existing.error || existing.status !== 0) {
  process.stderr.write(`Windows installation preflight failed after ${Date.now() - preflightStartedAt}ms:\n${inspect(existing, { depth: null })}\n`);
}
assert.ifError(existing.error);
assert.equal(existing.status, 0, existing.status === 1
  ? "Use a test account without an installed or running OvertChat"
  : "Windows installation preflight did not complete successfully");
const directory = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? tmpdir(), "overtchat-windows-smoke-"));
const installDirectory = path.join(directory, "app");
const executable = path.join(installDirectory, "overtchat.exe");
const settingsFile = path.join(profile, "settings.json");
const diagnostics = process.env.DESKTOP_SMOKE_ARTIFACT_DIR ?? directory;
await mkdir(diagnostics, { recursive: true });
// Only updater cache is redirected. DPAPI and appData use the real test account.
const env = { ...process.env, LOCALAPPDATA: path.join(directory, "local") };
const token = randomBytes(32).toString("hex");
let signIns = 0, apiLevel = CLIENT_API_LEVEL;
const api = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "overtchat://app");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "OPTIONS") return response.writeHead(204).end();
  const pathname = new URL(request.url, "http://localhost").pathname;
  let body;
  if (pathname === "/api/ping") body = { name: "overtchat", version: "windows-smoke", apiLevel };
  else if (pathname === "/api/setup") body = { required: false };
  else if (pathname === "/api/auth/get-session") body = null;
  else if (pathname === "/api/auth/sign-in/email" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const credentials = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(credentials.email, "qualification@example.invalid");
    assert.equal(credentials.password, "test-only-password");
    signIns++;
    response.setHeader("set-auth-token", token);
    body = { user: { id: "qualification", email: credentials.email, name: "Qualification" }, redirect: false };
  } else if (pathname === "/api/desktop-smoke/probe") body = { authorized: request.headers.authorization === `Bearer ${token}` };
  else if (pathname === "/api/auth/sign-out") body = { success: true };
  else return response.writeHead(404).end(JSON.stringify({ message: "Unknown fixture route" }));
  response.end(JSON.stringify(body));
});
await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${api.address().port}`;
let child, browser, page, feed;
let installed = false;
let output = "";
async function waitFor(label, callback, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await callback(); if (result) return result; } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`, { cause: lastError });
}
const state = () => page.evaluate(() => window.overtchatDesktop.getUpdateState());
const probe = () => page.evaluate(async server => (await fetch(`${server}/api/desktop-smoke/probe`)).json(), origin);
async function launch() {
  await rm(path.join(profile, "DevToolsActivePort"), { force: true });
  child = spawn(executable, ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  child.on("error", error => { output += String(error); });
  const endpoint = await waitFor("debugging endpoint", async () => {
    assert(child.exitCode === null && child.signalCode === null, "Packaged app exited before connecting");
    return `http://127.0.0.1:${(await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]}`;
  });
  browser = await chromium.connectOverCDP(endpoint);
  page = await waitFor("bundled renderer", () => browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith("overtchat://app")));
  await page.waitForFunction(() => typeof window.overtchatDesktop?.getUpdateState === "function");
}
async function quit() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await page.close().catch(() => {});
  await waitFor("normal app quit", () => child.exitCode !== null || child.signalCode !== null, 15_000);
  await browser.close().catch(() => {});
  browser = page = null;
}
function mainPids() {
  const quoted = executable.replaceAll("'", "''");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Get-CimInstance Win32_Process -Filter "Name = 'overtchat.exe'" | Where-Object { $_.ExecutablePath -eq '${quoted}' -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.ProcessId }`], { encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}
function verify(versionOverride) {
  const result = spawnSync(process.execPath, [".github/scripts/verify-desktop-windows.mjs", installDirectory,
    ...(versionOverride ? [versionOverride] : [])], { stdio: "inherit" });
  assert.equal(result.status, 0, "Installed Windows bundle failed verification");
}
try {
  // /D must be the last, unquoted NSIS argument, including when it has spaces.
  const result = spawnSync(path.resolve(installer), ["/S", `/D=${installDirectory}`], {
    windowsVerbatimArguments: true, stdio: "inherit", timeout: 120_000,
  });
  installed = true;
  assert.equal(result.status, 0, "Baseline installer failed");
  await access(executable);
  verify("0.0.0");
  feed = spawn(process.execPath, [".github/scripts/serve-desktop-update-test.mjs", path.resolve(candidates), "4931", "--interrupt-once"], { stdio: ["ignore", "pipe", "pipe"] });
  feed.stdout.on("data", chunk => { output += chunk; });
  feed.stderr.on("data", chunk => { output += chunk; });
  await waitFor("candidate feed", async () => (await fetch("http://127.0.0.1:4931/stable.yml")).ok);
  await launch();
  assert.deepEqual(await page.evaluate(() => [typeof window.require, typeof window.process]), ["undefined", "undefined"]);
  assert.equal(await page.evaluate(() => window.overtchatDesktop.platform), "win32");
  const initial = await waitFor("update discovery", async () => {
    const current = await state();
    return current.status === "available" ? current : null;
  });
  assert.equal(initial.availableVersion, version);
  assert.notEqual(initial.currentVersion, version);
  assert(!output.includes("Interrupted"), "Discovery downloaded an installer without an action");
  await page.getByLabel("Server address").fill(origin);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await page.getByLabel("Email", { exact: true }).fill("qualification@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await waitFor("saved login", async () => (await probe()).authorized && !!JSON.parse(await readFile(settingsFile, "utf8")).sessionToken);
  assert(!(await readFile(settingsFile, "utf8")).includes(token));
  for (const incompatible of [CLIENT_API_LEVEL - 1, CLIENT_API_LEVEL + 1]) {
    apiLevel = incompatible;
    const checked = await page.evaluate(() => window.overtchatDesktop.checkForUpdates());
    assert.equal(checked.status, "blocked");
    assert.equal((await page.evaluate(() => window.overtchatDesktop.downloadUpdate())).status, "blocked");
  }
  apiLevel = CLIENT_API_LEVEL;
  const interrupted = await page.evaluate(() => window.overtchatDesktop.downloadUpdate());
  assert.equal(interrupted.status, "error", "Interrupted download must be retryable");
  assert(output.includes("Interrupted"));
  assert((await fetch("http://127.0.0.1:4931/__resume", { method: "POST" })).ok);
  assert.equal((await page.evaluate(() => window.overtchatDesktop.downloadUpdate())).status, "ready");
  apiLevel = CLIENT_API_LEVEL + 1;
  await assert.rejects(page.evaluate(() => window.overtchatDesktop.installUpdate()), /support/);
  assert.equal((await state()).status, "blocked");
  apiLevel = CLIENT_API_LEVEL;
  assert.equal((await page.evaluate(() => window.overtchatDesktop.downloadUpdate())).status, "ready");
  await quit();
  await launch();
  assert.equal((await state()).currentVersion, initial.currentVersion, "Normal quitting installed an update");
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await waitFor("login after normal quit", async () => (await probe()).authorized);
  assert.equal(signIns, 1);
  assert.equal((await page.evaluate(() => window.overtchatDesktop.downloadUpdate())).status, "ready");
  await page.evaluate(() => window.overtchatDesktop.installUpdate());
  await waitFor("old app exit", () => child.exitCode !== null || child.signalCode !== null, 120_000);
  await browser.close().catch(() => {});
  browser = page = null;
  await waitFor("automatic updated-app restart", () => mainPids().length > 0, 120_000);
  // NSIS's relaunch does not promise to preserve debugging arguments.
  // Verify it relaunched, then start a controlled debugging session for assertions.
  for (const pid of mainPids()) process.kill(pid, "SIGTERM");
  await waitFor("updated app stop", () => mainPids().length === 0);
  await launch();
  assert.equal((await state()).currentVersion, version);
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await waitFor("login after real installation", async () => (await probe()).authorized);
  assert.equal(signIns, 1, "Upgrade lost the saved login");
  verify();
  await page.screenshot({ path: path.join(diagnostics, "windows-upgraded.png") });
  await page.evaluate(async server => { await fetch(`${server}/api/auth/sign-out`, { method: "POST" }); }, origin);
  await waitFor("sign-out persistence", async () => JSON.parse(await readFile(settingsFile, "utf8")).sessionToken === null);
  await quit();
  await launch();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  assert.equal((await probe()).authorized, false, "Sign-out did not survive relaunch");
  await quit();
  process.stdout.write(`PASS ${process.platform}/${process.arch}: discovery, API guards, interrupted download/retry, normal quit, real install/relaunch ${initial.currentVersion} -> ${version}, encrypted login retained\n`);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(diagnostics, "windows-failure.png") }).catch(() => {});
  throw error;
} finally {
  for (const pid of mainPids()) process.kill(pid, "SIGTERM");
  if (browser) await browser.close().catch(() => {});
  await waitFor("qualification app cleanup", () => mainPids().length === 0);
  if (feed) feed.kill("SIGTERM");
  await new Promise(resolve => api.close(resolve));
  await writeFile(path.join(diagnostics, "qualification.log"), output.replaceAll(token, "[REDACTED]"));
  if (installed) {
    const result = spawnSync(path.join(installDirectory, "Uninstall overtchat.exe"), ["/S", `_?=${installDirectory}`], {
      windowsVerbatimArguments: true, stdio: "inherit", timeout: 120_000,
    });
    assert.equal(result.status, 0, "Uninstall failed");
    await waitFor("uninstall", async () => { try { await access(executable); return false; } catch (error) { if (error.code === "ENOENT") return true; throw error; } });
    process.stdout.write("PASS Windows uninstall removed the installed executable\n");
  }
  // The profile did not exist before this smoke; remove only test-owned data.
  await rm(profile, { recursive: true, force: true });
  await rm(path.join(directory, "local"), { recursive: true, force: true });
  process.stdout.write(`Qualification diagnostics: ${diagnostics}\n`);
}
