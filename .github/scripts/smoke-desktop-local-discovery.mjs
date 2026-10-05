// Exercise discovery through the packaged renderer, preload and Electron transport.
/* global window */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { log } from "node:console";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { CLIENT_API_LEVEL } from "../../packages/shared/src/ping.ts";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const [executable] = process.argv.slice(2);
assert(executable, "Usage: node smoke-desktop-local-discovery.mjs packaged-linux-executable");
assert.equal(process.platform, "linux");
assert.notEqual(process.getuid(), 0, "Test the desktop as a regular user");
const directory = await mkdtemp(path.join(tmpdir(), "overtchat-local-discovery-smoke-"));
const config = path.join(directory, "config");
const manager = path.join(directory, "manager");
await mkdir(config);
await mkdir(manager);
let apiLevel = CLIENT_API_LEVEL;
let available = true;
const api = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "overtchat://app");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/api/ping") {
    // Leave time to type while discovery is still pending.
    await delay(400);
    if (!available) return response.writeHead(503).end("{}");
    return response.end(JSON.stringify({ name: "overtchat", version: "discovery-smoke", apiLevel }));
  }
  if (request.url === "/api/setup") return response.end('{"required":false}');
  if (request.url === "/api/auth/get-session") return response.end("null");
  response.writeHead(404).end("{}");
});
await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
const port = api.address().port;
const origin = `http://localhost:${port}`;
await writeFile(path.join(manager, "installation.json"), JSON.stringify({ format: 1, appPort: port }));

let child, browser, page;
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
async function launch() {
  await rm(path.join(config, "overtchat/DevToolsActivePort"), { force: true });
  child = spawn(path.resolve(executable), ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--password-store=basic"], {
    env: { ...process.env, XDG_CONFIG_HOME: config, OVERTCHAT_CONFIG_DIR: manager,
      XDG_DATA_HOME: path.join(directory, "data"), XDG_CACHE_HOME: path.join(directory, "cache") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  child.on("error", error => { output += String(error); });
  const endpoint = await waitFor("debugging endpoint", async () => {
    assert(child.exitCode === null && child.signalCode === null, `Desktop exited:\n${output}`);
    return `http://127.0.0.1:${(await readFile(path.join(config, "overtchat/DevToolsActivePort"), "utf8")).split("\n")[0]}`;
  });
  browser = await chromium.connectOverCDP(endpoint);
  page = await waitFor("bundled renderer", () => browser.contexts().flatMap(context => context.pages())
    .find(candidate => candidate.url().startsWith("overtchat://app")));
}
async function stop() {
  if (page) await page.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  page = browser = null;
  if (child && child.exitCode === null && child.signalCode === null) {
    try { await waitFor("normal app exit", () => child.exitCode !== null || child.signalCode !== null, 5_000); }
    catch {
      child.kill("SIGKILL");
      await new Promise(resolve => child.once("exit", resolve));
    }
  }
  child = null;
}
function localCard() {
  return page.getByRole("region", { name: "Servers on this computer" }).locator("div.rounded-lg").filter({ hasText: `localhost:${port}` });
}
try {
  await launch();
  await page.getByLabel("Server address").fill("https://manual.example.invalid");
  await localCard().getByRole("button", { name: "Connect", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Server address").inputValue(), "https://manual.example.invalid");
  assert.equal((await page.evaluate(() => window.overtchatDesktop.boot())).server, null);
  assert.deepEqual(await page.evaluate(() => [typeof window.require, typeof window.process]), ["undefined", "undefined"]);
  const cdp = await browser.newBrowserCDPSession();
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const renderer = processInfo.find(info => info.type === "renderer");
  assert(renderer, "Missing renderer process");
  const status = await readFile(`/proc/${renderer.id}/status`, "utf8");
  assert.match(status, /^Seccomp:\s+2$/m);
  assert.match(status, /^NoNewPrivs:\s+1$/m);
  assert(status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/).length >= 2);
  await cdp.detach();
  await localCard().getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  assert.equal((await page.evaluate(() => window.overtchatDesktop.boot())).server.origin, origin);
  log("PASS custom-port discovery, manual input preserved, explicit Connect and rendered login");
  await stop();

  await launch();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  assert.equal((await page.evaluate(() => window.overtchatDesktop.boot())).server.origin, origin);
  assert.deepEqual(await page.evaluate(() => window.overtchatDesktop.discoverLocalServers()), []);
  log("PASS saved server restored on relaunch; discovery leaves active server alone");
  await page.evaluate(() => window.overtchatDesktop.changeServer());
  await page.getByRole("heading", { name: "Connect to your server" }).waitFor();
  await localCard().getByRole("button", { name: "Connect", exact: true }).waitFor();

  for (const level of [CLIENT_API_LEVEL - 1, CLIENT_API_LEVEL + 1]) {
    apiLevel = level;
    await page.getByRole("button", { name: "Check again", exact: true }).click();
    await localCard().getByText(level < CLIENT_API_LEVEL ? "Server update required" : "Desktop update required", { exact: true }).waitFor();
    await localCard().getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal((await page.evaluate(() => window.overtchatDesktop.boot())).server, null);
    await page.getByRole("button", { name: "Continue", exact: true }).waitFor({ state: "visible" });
  }
  available = false;
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await localCard().waitFor({ state: "hidden" });
  apiLevel = CLIENT_API_LEVEL;
  available = true;
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await localCard().getByRole("button", { name: "Connect", exact: true }).waitFor();
  log("PASS outdated/newer server rejection and Check again after server availability changes");
  if (process.env.DESKTOP_SMOKE_ARTIFACT_DIR) {
    await mkdir(process.env.DESKTOP_SMOKE_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.DESKTOP_SMOKE_ARTIFACT_DIR, "local-discovery.png") });
  }
  if (process.env.DESKTOP_DISCOVERY_LIVE_ORIGIN) {
    const live = new URL(process.env.DESKTOP_DISCOVERY_LIVE_ORIGIN);
    assert(live.protocol === "http:" && live.hostname === "localhost", "Live smoke must use a localhost server");
    const card = page.getByRole("region", { name: "Servers on this computer" }).locator("div.rounded-lg").filter({ hasText: live.host });
    await card.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("heading", { name: /Welcome back|Create the first account/ }).waitFor();
    assert.equal((await page.evaluate(() => window.overtchatDesktop.boot())).server.origin, live.origin);
    log(`PASS discovery and Connect against live OvertChat at ${live.origin}`);
    if (process.env.DESKTOP_SMOKE_ARTIFACT_DIR) {
      await page.screenshot({ path: path.join(process.env.DESKTOP_SMOKE_ARTIFACT_DIR, "local-discovery-live.png") });
    }
  }
} catch (error) {
  log(output);
  throw error;
} finally {
  await stop();
  api.closeAllConnections();
  await new Promise(resolve => api.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
