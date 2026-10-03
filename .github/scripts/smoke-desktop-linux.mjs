// Launch the real package with isolated settings and a local API fixture. This
// verifies packaging, IPC, auth transport/storage and the OS renderer sandbox;
// the normal web E2E suite owns full server/chat behavior.
/* global window, fetch */
import assert from "node:assert/strict";
import { CLIENT_API_LEVEL } from "../../packages/shared/src/ping.ts";
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { log } from "node:console";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const [executable, storage, backend = "gnome-libsecret"] = process.argv.slice(2);
assert(executable && ["persistent", "session"].includes(storage),
  "Usage: node smoke-desktop-linux.mjs executable persistent|session [gnome-libsecret|kwallet5|kwallet6]");
assert(["gnome-libsecret", "kwallet5", "kwallet6"].includes(backend));
assert.equal(process.platform, "linux");
assert.notEqual(process.getuid(), 0, "Test the desktop as a regular user");
const directory = await mkdtemp(path.join(tmpdir(), "overtchat-linux-smoke-"));
const config = path.join(directory, "config");
await mkdir(config);
const settingsFile = path.join(config, "overtchat/settings.json");
const diagnostics = process.env.DESKTOP_SMOKE_ARTIFACT_DIR;
const upgradeDeb = process.env.DESKTOP_SMOKE_UPGRADE_DEB;
assert(!upgradeDeb || storage === "persistent", "Upgrade smoke must check persisted login");
if (diagnostics) await mkdir(diagnostics, { recursive: true });
const token = randomBytes(32).toString("hex");
let signIns = 0;
const api = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "overtchat://app");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "OPTIONS") return response.writeHead(204).end();
  const pathname = new URL(request.url, "http://localhost").pathname;
  let body;
  if (pathname === "/api/ping") body = { name: "overtchat", version: "smoke", apiLevel: CLIENT_API_LEVEL };
  else if (pathname === "/api/setup") body = { required: false };
  // Keep the login page visible; the fixture tests shell auth, not chat APIs.
  else if (pathname === "/api/auth/get-session") body = null;
  else if (pathname === "/api/auth/sign-in/email" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const credentials = JSON.parse(Buffer.concat(chunks).toString());
    if (credentials.email !== "smoke@example.invalid" || credentials.password !== "test-only-password") {
      return response.writeHead(400).end(JSON.stringify({ message: "Unexpected smoke credentials" }));
    }
    signIns++;
    response.setHeader("set-auth-token", token);
    body = { user: { id: "smoke", email: credentials.email, name: "Smoke" }, redirect: false };
  } else if (pathname === "/api/desktop-smoke/probe") {
    body = { authorized: request.headers.authorization === `Bearer ${token}` };
  } else if (pathname === "/api/auth/sign-out") body = { success: true };
  else return response.writeHead(404).end(JSON.stringify({ message: "Unknown fixture route" }));
  response.end(JSON.stringify(body));
});
await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${api.address().port}`;

async function waitFor(label, callback, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await callback();
      if (result) return result;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`, { cause: lastError });
}

let child;
let browser;
let page;
let output = "";
async function stop() {
  // Closing the Linux main window exercises the normal app.quit/flush path.
  if (page) await page.close().catch(() => {});
  page = null;
  if (browser) await browser.close().catch(() => {});
  browser = null;
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    // AppImage's extract-and-run entrypoint wraps Electron in another process.
    // Stop the entire test-owned process group, not just the runtime wrapper.
    try { await waitFor("app exit", () => child.exitCode !== null || child.signalCode !== null, 10_000); }
    catch {
      process.kill(-child.pid, "SIGTERM");
      try { await waitFor("app termination", () => child.exitCode !== null || child.signalCode !== null, 5_000); }
      catch { process.kill(-child.pid, "SIGKILL"); await new Promise(resolve => child.once("exit", resolve)); }
    }
  }
  child = null;
}

try {
  const rejected = spawnSync(path.resolve(executable), ["--no-sandbox"], {
    env: { ...process.env, XDG_CONFIG_HOME: config }, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(rejected.status, 1, `Expected refusal of an unsandboxed launch: ${rejected.stderr}`);
  assert.match(rejected.stderr, /OvertChat requires the Linux sandbox/);
  for (let cycle = 1; cycle <= 3; cycle++) {
    await rm(path.join(config, "overtchat/DevToolsActivePort"), { force: true });
    const data = path.join(directory, "data");
    child = spawn(path.resolve(executable), ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
      ...(storage === "session" ? ["--password-store=basic"] : [`--password-store=${backend}`])], {
      env: { ...process.env, XDG_CONFIG_HOME: config, XDG_DATA_HOME: data,
        XDG_CACHE_HOME: path.join(directory, "cache"), XDG_CURRENT_DESKTOP: backend.startsWith("kwallet") ? "KDE" : "GNOME" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    child.on("error", error => { output += String(error); });
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const endpoint = await waitFor("debugging endpoint", async () => {
      assert(child.exitCode === null && child.signalCode === null, `Packaged app exited:\n${output}`);
      const lines = (await readFile(path.join(config, "overtchat/DevToolsActivePort"), "utf8")).trim().split("\n");
      return `http://127.0.0.1:${lines[0]}`;
    });
    browser = await waitFor("browser connection", () => chromium.connectOverCDP(endpoint, { timeout: 1_000 }));
    page = await waitFor("bundled renderer", () => browser.contexts().flatMap(context => context.pages())
      .find(candidate => candidate.url().startsWith("overtchat://app")));
    await page.waitForFunction(() => typeof window.overtchatDesktop?.boot === "function");
    assert.deepEqual(await page.evaluate(() => [typeof window.require, typeof window.process]),
      ["undefined", "undefined"]);
    assert.equal(await page.evaluate(() => window.overtchatDesktop.platform), "linux");
    if (cycle === 1) {
      await page.getByLabel("Server address").fill(origin);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    }
    await page.getByRole("heading", { name: "Welcome back" }).waitFor();
    const boot = await page.evaluate(() => window.overtchatDesktop.boot());
    assert.equal(boot.server.origin, origin);
    assert.equal(boot.server.problem, null);

    const cdp = await browser.newBrowserCDPSession();
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    const renderer = processInfo.find(info => info.type === "renderer");
    assert(renderer, "Missing renderer process");
    const status = await readFile(`/proc/${renderer.id}/status`, "utf8");
    assert.match(status, /^Seccomp:\s+2$/m, "Renderer must use seccomp filtering");
    assert.match(status, /^NoNewPrivs:\s+1$/m);
    const namespacePids = status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/);
    assert(namespacePids?.length >= 2, "Renderer must have a nested PID namespace");
    const cmdline = await readFile(`/proc/${renderer.id}/cmdline`, "utf8");
    assert(!cmdline.includes("--no-sandbox"));
    await cdp.detach();

    const probe = () => page.evaluate(async server => (await fetch(`${server}/api/desktop-smoke/probe`)).json(), origin);
    assert.equal((await probe()).authorized, cycle === 2 && storage === "persistent");
    if (cycle === 1) {
      await page.getByLabel("Email", { exact: true }).fill("smoke@example.invalid");
      await page.getByLabel("Password", { exact: true }).fill("test-only-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await waitFor("sign-in transport", () => signIns === 1);
      await waitFor("main-process bearer injection", async () => (await probe()).authorized);
      await waitFor("saved settings", async () => {
        const raw = await readFile(settingsFile, "utf8");
        const settings = JSON.parse(raw);
        assert(!raw.includes(token), "Token reached disk without encryption");
        return storage === "persistent" ? !!settings.sessionToken : settings.sessionToken === null;
      });
    }
    if (cycle === 2) {
      await page.evaluate(async server => { await fetch(`${server}/api/auth/sign-out`, { method: "POST" }); }, origin);
      await waitFor("sign-out persistence", async () => JSON.parse(await readFile(settingsFile, "utf8")).sessionToken === null);
      assert.equal((await probe()).authorized, false);
    }
    if (diagnostics) await page.screenshot({ path: path.join(diagnostics, `${storage}-${cycle}.png`) });
    await stop();
    log(`PASS ${storage} cycle ${cycle}: bundled UI, IPC, auth and kernel sandbox`);
    if (cycle === 1 && upgradeDeb) {
      const upgrade = spawnSync("sudo", ["-n", "apt-get", "install", "-y", path.resolve(upgradeDeb)], {
        stdio: "inherit", timeout: 120_000,
      });
      assert.equal(upgrade.status, 0, "Candidate upgrade failed");
      log("PASS candidate package upgrade; next launch must restore encrypted login");
    }
  }
} catch (error) {
  if (diagnostics && page) await page.screenshot({ path: path.join(diagnostics, `${storage}-failure.png`) }).catch(() => {});
  throw error;
} finally {
  await stop();
  await new Promise(resolve => api.close(resolve));
  if (diagnostics) await writeFile(path.join(diagnostics, `${storage}.log`), output.replaceAll(token, "[REDACTED]"));
  await rm(directory, { recursive: true, force: true });
}
