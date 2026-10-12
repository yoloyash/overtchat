// Exercise native window operations through the real renderer/preload/main.
/* global getComputedStyle, localStorage */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

import { CLIENT_API_LEVEL } from "../../packages/shared/src/ping.ts";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { _electron: electron, expect } = require("@playwright/test");
assert.equal(process.platform, "win32");
const directory = await mkdtemp(path.join(tmpdir(), "overtchat-windows-chrome-"));
const diagnostics = process.env.DESKTOP_SMOKE_ARTIFACT_DIR ?? directory;
await mkdir(diagnostics, { recursive: true });
const main = pathToFileURL(path.resolve("apps/desktop/out/main/index.js")).href;
const wrapper = path.join(directory, "main.mjs");
await writeFile(wrapper, `import { app } from "electron";
app.setPath("appData", ${JSON.stringify(directory)});
await import(${JSON.stringify(main)});
`);
let signedIn = false;
const api = createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "overtchat://app");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/api/ping") return response.end(JSON.stringify({ name: "overtchat", apiLevel: CLIENT_API_LEVEL }));
  if (request.url === "/api/setup") return response.end('{"required":false}');
  if (request.url === "/api/auth/get-session") return response.end(JSON.stringify(signedIn ? {
    user: { id: "chrome-test", email: "chrome@example.invalid", name: "Window test", role: "user" },
    session: { id: "chrome-test", userId: "chrome-test", expiresAt: "2099-01-01T00:00:00.000Z" },
  } : null));
  if (request.url === "/api/chats") return response.end('{"chats":[]}');
  if (request.url === "/api/chats/active") return response.end('{"activeChatIds":[]}');
  if (request.url === "/api/projects") return response.end('{"projects":[]}');
  if (request.url === "/api/model-configs") return response.end('{"modelConfigs":[]}');
  if (request.url === "/api/capabilities") return response.end('{"capabilities":{}}');
  response.writeHead(404).end("{}");
});
await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
let app, page;

// CDP clicks bypass Windows non-client hit testing. Check the actual HWND too:
// HTCLIENT (1) accepts clicks; HTCAPTION (2) turns these buttons into drag areas.
async function assertNativeControlTargets() {
  const buttons = page.getByRole("group", { name: "Window controls" }).getByRole("button");
  const points = [];
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    assert(box, "Window control must be visible");
    points.push([box.x + box.width / 2, box.y + box.height / 2]);
  }
  assert.equal(points.length, 3);
  const { handle, zoom } = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { handle: Number(win.getNativeWindowHandle().readBigUInt64LE()), zoom: win.webContents.getZoomFactor() };
  });
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WindowHitTest {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
}
'@
[void][WindowHitTest]::SetThreadDpiAwarenessContext([IntPtr](-4))
$handle = [IntPtr]${handle}
$scale = [WindowHitTest]::GetDpiForWindow($handle) / 96
$points = @(${points.map(([x, y]) => `@(${x}, ${y})`).join(", ")})
foreach ($point in $points) {
  $p = New-Object WindowHitTest+POINT
  $p.X = [int]($point[0] * ${zoom} * $scale)
  $p.Y = [int]($point[1] * ${zoom} * $scale)
  if (![WindowHitTest]::ClientToScreen($handle, [ref]$p)) { throw 'ClientToScreen failed' }
  $position = ($p.Y -shl 16) -bor ($p.X -band 65535)
  [WindowHitTest]::SendMessage($handle, 0x84, [IntPtr]::Zero, [IntPtr]$position).ToInt64()
}
`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.deepEqual(result.stdout.trim().split(/\s+/).map(Number), [1, 1, 1],
    "Native Windows hit testing must route all three controls to the renderer, not the draggable header");
}

try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [wrapper], env });
  page = await app.firstWindow();
  await page.getByLabel("Server address").waitFor();
  await expect(page.getByRole("group", { name: "Window controls" })).toBeVisible();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  assert.equal(await page.locator("html").getAttribute("data-desktop-shell"), "win32");
  assert.equal(await page.locator("[data-titlebar]").evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")), "drag");
  assert.equal(await page.locator(".desktop-window-controls").evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")), "no-drag");
  await assertNativeControlTargets();

  // Observe actual BrowserWindow state, not just the labels returned by IPC.
  await page.getByRole("button", { name: "Maximize window", exact: true }).click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
  await assertNativeControlTargets();
  await page.getByRole("button", { name: "Restore window", exact: true }).click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
  await page.getByRole("button", { name: "Minimize window", exact: true }).click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.focus(); });
  // Also cover state changes originating outside the custom buttons.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await expect(page.getByRole("button", { name: "Restore window", exact: true })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  await expect(page.getByRole("button", { name: "Maximize window", exact: true })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
  await expect(page.getByRole("group", { name: "Window controls" })).toBeHidden();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false));
  await expect(page.getByRole("group", { name: "Window controls" })).toBeVisible();

  // Zoom and narrow windows must keep all controls visible and clickable.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(600, 600);
    win.webContents.setZoomFactor(1.25);
  });
  const controls = await page.getByRole("group", { name: "Window controls" }).boundingBox();
  assert(controls && controls.x >= 0 && controls.y === 0);
  await assertNativeControlTargets();
  await page.getByRole("button", { name: "Maximize window", exact: true }).click();
  await page.getByRole("button", { name: "Restore window", exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setZoomFactor(1);
    win.setSize(1240, 820);
  });
  await page.getByLabel("Server address").fill(`http://127.0.0.1:${api.address().port}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await expect(page.getByRole("group", { name: "Window controls" })).toBeVisible();
  await assertNativeControlTargets();
  await page.screenshot({ path: path.join(diagnostics, "windows-chrome.png") });
  signedIn = true;
  await page.reload();
  const header = page.locator("main header[data-titlebar]").first();
  await header.waitFor();
  const temp = page.getByRole("button", { name: "Enable temporary chat", exact: true });
  await temp.waitFor();
  // Shared chat header actions must clear the window buttons at all sizes.
  for (const width of [1240, 600, 420]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 820), width);
    await expect.poll(async () => {
      const action = await temp.boundingBox();
      const buttons = await page.getByRole("group", { name: "Window controls" }).boundingBox();
      return action && buttons && action.x + action.width <= buttons.x;
    }).toBe(true);
    await assertNativeControlTargets();
  }
  await temp.click();
  await expect(page.getByRole("button", { name: "Disable temporary chat", exact: true })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1240, 820));
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open sidebar", exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.reload();
  await page.getByRole("button", { name: "Open sidebar", exact: true }).waitFor();
  await assertNativeControlTargets();
  await page.screenshot({ path: path.join(diagnostics, "windows-chrome-chat.png"), animations: "disabled" });
  const closed = app.waitForEvent("close");
  await page.getByRole("button", { name: "Close window", exact: true }).click();
  await closed;
  process.stdout.write("PASS Windows chrome: native hit targets, hidden native menu, drag regions, maximize/restore, minimize, external state changes, fullscreen, zoom, sign-in, narrow chat headers, collapsed sidebar, close\n");
} catch (error) {
  if (page) await page.screenshot({ path: path.join(diagnostics, "windows-chrome-failure.png") }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await new Promise(resolve => api.close(resolve));
  await rm(path.join(directory, "overtchat-dev"), { recursive: true, force: true });
}
