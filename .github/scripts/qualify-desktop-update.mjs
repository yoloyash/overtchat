// Exercise the real installed updater against exact, private release candidates.
/* global window, fetch */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const [executableArgument, candidates, version] = process.argv.slice(2);
assert(executableArgument && candidates && /^\d+\.\d+\.\d+$/.test(version),
  "Usage: node qualify-desktop-update.mjs baseline-executable candidate-directory target-version");
const executable = path.resolve(executableArgument);
const isMac = process.platform === "darwin";
assert(isMac || process.platform === "linux");
if (isMac) {
  const running = spawnSync("ps", ["-axo", "command="], { encoding: "utf8" }).stdout;
  assert(!/^\S*\/overtchat\.app\/Contents\/MacOS\/overtchat(?:\s|$)/m.test(running), "Quit existing installed desktop apps before qualification");
}
const directory = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? tmpdir(), "overtchat-update-qualification-"));
const config = path.join(directory, "config");
await mkdir(config);
const profile = isMac ? path.join(homedir(), "Library/Application Support/overtchat") : path.join(config, "overtchat");
const settingsFile = path.join(profile, "settings.json");
let backedUp = false;
if (isMac) {
  try {
    await access(profile);
    await rename(profile, path.join(directory, "profile-backup"));
    backedUp = true;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const env = isMac ? process.env : { ...process.env, XDG_CONFIG_HOME: config,
  XDG_DATA_HOME: path.join(directory, "data"), XDG_CACHE_HOME: path.join(directory, "cache"), XDG_CURRENT_DESKTOP: "GNOME" };
const token = randomBytes(32).toString("hex");
let signIns = 0, apiLevel = 1;
const api = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "overtchat://app");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "OPTIONS") return response.writeHead(204).end();
  const pathname = new URL(request.url, "http://localhost").pathname;
  let body;
  if (pathname === "/api/ping") body = { name: "overtchat", version: "0.23.1", apiLevel };
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
  else return response.writeHead(404).end(JSON.stringify({ message: "Unknown fixture route" }));
  response.end(JSON.stringify(body));
});
await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${api.address().port}`;
let child, browser, page, feed;
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
  child = spawn(executable, ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    ...(!isMac ? ["--password-store=gnome-libsecret"] : [])], { env, stdio: ["ignore", "pipe", "pipe"] });
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
  await page.keyboard.press(isMac ? "Meta+Q" : "Control+Q").catch(() => {});
  await waitFor("normal app quit", () => child.exitCode !== null || child.signalCode !== null, 15_000);
  await browser.close().catch(() => {});
  browser = page = null;
}
function mainPids() {
  const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  return result.stdout.split("\n").flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match && (match[2] === executable || match[2].startsWith(`${executable} `)) ? [Number(match[1])] : [];
  });
}
async function restoreMacProfile() {
  try { await rename(profile, path.join(directory, "test-profile")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (backedUp) await rename(path.join(directory, "profile-backup"), profile);
}
try {
  feed = spawn(process.execPath, [".github/scripts/serve-desktop-update-test.mjs", path.resolve(candidates), "4931", "--interrupt-once"], { stdio: ["ignore", "pipe", "pipe"] });
  feed.stdout.on("data", chunk => { output += chunk; });
  feed.stderr.on("data", chunk => { output += chunk; });
  await waitFor("candidate feed", async () => (await fetch("http://127.0.0.1:4931/stable" + (isMac ? `-${process.arch}-mac` : "-linux") + ".yml")).ok);
  await launch();
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
  for (const incompatible of [0, 2]) {
    apiLevel = incompatible;
    const checked = await page.evaluate(() => window.overtchatDesktop.checkForUpdates());
    assert.equal(checked.status, "blocked");
    assert.equal((await page.evaluate(() => window.overtchatDesktop.downloadUpdate())).status, "blocked");
  }
  apiLevel = 1;
  const interrupted = await page.evaluate(() => window.overtchatDesktop.downloadUpdate());
  assert.equal(interrupted.status, "error", "Interrupted download must be retryable");
  assert(output.includes("Interrupted"));
  assert((await fetch("http://127.0.0.1:4931/__resume", { method: "POST" })).ok);
  assert.equal((await page.evaluate(() => window.overtchatDesktop.downloadUpdate())).status, "ready");
  apiLevel = 2;
  await assert.rejects(page.evaluate(() => window.overtchatDesktop.installUpdate()), /support/);
  assert.equal((await state()).status, "blocked");
  apiLevel = 1;
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
  // Squirrel's relaunch does not promise to preserve debugging arguments.
  // Verify it relaunched, then start a controlled debugging session for assertions.
  for (const pid of mainPids()) process.kill(pid, "SIGTERM");
  await waitFor("updated app stop", () => mainPids().length === 0);
  await launch();
  assert.equal((await state()).currentVersion, version);
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await waitFor("login after real installation", async () => (await probe()).authorized);
  assert.equal(signIns, 1, "Upgrade lost the saved login");
  await quit();
  process.stdout.write(`PASS ${process.platform}/${process.arch}: discovery, API guards, interrupted download/retry, normal quit, real install/relaunch ${initial.currentVersion} -> ${version}, encrypted login retained\n`);
} finally {
  for (const pid of mainPids()) process.kill(pid, "SIGTERM");
  if (browser) await browser.close().catch(() => {});
  await waitFor("qualification app cleanup", () => mainPids().length === 0);
  if (feed) feed.kill("SIGTERM");
  await new Promise(resolve => api.close(resolve));
  await writeFile(path.join(directory, "qualification.log"), output.replaceAll(token, "[REDACTED]"));
  if (isMac) await restoreMacProfile();
  process.stdout.write(`Qualification diagnostics: ${directory}\n`);
}
