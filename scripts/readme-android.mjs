import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.join(root, ".readme-media");
const device = process.env.MEDIA_ANDROID_DEVICE;
if (!device) throw new Error("Set MEDIA_ANDROID_DEVICE to the Android serial from adb devices -l.");
const env = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: "1", MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true" };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const interruption = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => interruption.abort());
const adb = (...args) => execFileSync("adb", ["-s", device, ...args], { encoding: "utf8", timeout: 30_000 }).trim();
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit", signal: interruption.signal });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)));
});
const server = JSON.parse(await fs.readFile(path.join(work, "server.json"), "utf8"));
const ping = await fetch(`${server.baseURL}/api/ping`).catch(() => null);
if (!ping?.ok) throw new Error("Run npm run media:serve in another terminal first.");
const app = JSON.parse(await fs.readFile(path.join(root, "apps/mobile/app.json"), "utf8")).expo;
const packageId = app.android.package;
const apk = process.env.MEDIA_ANDROID_APK
  ? path.resolve(process.env.MEDIA_ANDROID_APK)
  : path.join(work, "android", `overtchat-v${app.version}.apk`);
await fs.mkdir(path.dirname(apk), { recursive: true });
const apkURL = `https://github.com/yoloyash/overtchat/releases/download/mobile-v${app.version}/overtchat-v${app.version}.apk`;
try { await fs.access(apk); } catch {
  if (process.env.MEDIA_ANDROID_APK) throw new Error("MEDIA_ANDROID_APK does not exist.");
  await run("curl", ["-fL", apkURL, "-o", apk]);
}
const maestro = path.join(work, "tools/maestro/bin/maestro");
try { await fs.access(maestro); } catch {
  await fs.mkdir(path.join(work, "tools"), { recursive: true });
  const zip = path.join(work, "tools/maestro.zip");
  await run("curl", ["-fL", "https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.10.0/maestro.zip", "-o", zip]);
  if (hash(await fs.readFile(zip)) !== "29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991") throw new Error("Maestro archive checksum mismatch.");
  await run("unzip", ["-q", "-o", zip, "-d", path.join(work, "tools")]);
}
const maestroVersion = execFileSync(maestro, ["--version"], { env, encoding: "utf8" }).trim();
if (maestroVersion !== "2.10.0") throw new Error("This capture uses Maestro 2.10.0.");
await run("adb", ["-s", device, "install", "-r", apk]);
const installed = adb("shell", "dumpsys", "package", packageId);
const installedVersion = installed.match(/versionName=(\S+)/)?.[1];
if (installedVersion !== app.version) throw new Error(`APK version ${installedVersion} does not match source ${app.version}.`);
const previousDemo = adb("shell", "settings", "get", "global", "sysui_demo_allowed");
const previousDemoOn = adb("shell", "settings", "get", "global", "sysui_tuner_demo_on");
const previousScreenTimeout = adb("shell", "settings", "get", "system", "screen_off_timeout");
if (previousDemoOn === "1") throw new Error("Exit Android's existing status-bar demo mode before capture so it can be restored cleanly.");
const broadcast = (...args) => adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", ...args);
const output = path.join(work, "android", "capture");
await fs.rm(output, { recursive: true, force: true });
try {
  interruption.signal.throwIfAborted();
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "wm", "dismiss-keyguard");
  adb("shell", "settings", "put", "system", "screen_off_timeout", "600000");
  adb("reverse", "tcp:4799", `tcp:${server.port}`);
  adb("shell", "settings", "put", "global", "sysui_demo_allowed", "1");
  broadcast("-e", "command", "enter");
  broadcast("-e", "command", "clock", "-e", "hhmm", "0941");
  broadcast("-e", "command", "notifications", "-e", "visible", "false");
  broadcast("-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false");
  broadcast("-e", "command", "network", "-e", "wifi", "show", "-e", "level", "4", "-e", "mobile", "hide", "-e", "nosim", "false");
  await run(maestro, ["--device", device, "test", "-e", "SERVER_URL=http://127.0.0.1:4799", "-e", "SERVER_HOST=127.0.0.1:4799", "--test-output-dir", output, path.join(root, "apps/mobile/media/capture.yaml")]);
  const files = await fs.readdir(output, { recursive: true });
  const candidates = [];
  for (const name of ["android-chat.png", "android-projects.png"]) {
    const relative = files.find((file) => file.endsWith(`/takeScreenshot/${name}`));
    if (!relative) throw new Error(`Maestro did not produce ${name}`);
    const bytes = await fs.readFile(path.join(output, relative));
    if (bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a" || bytes.length > 2_000_000) throw new Error(`Invalid or oversized capture: ${name}`);
    candidates.push({ name, relative });
  }
  interruption.signal.throwIfAborted();
  await fs.mkdir(path.join(root, ".github/assets"), { recursive: true });
  for (const { name, relative } of candidates) await fs.copyFile(path.join(output, relative), path.join(root, ".github/assets", name));
  console.log("Captured native Android chat and projects in .github/assets.");
} finally {
  const cleanup = [
    () => previousScreenTimeout === "null"
      ? adb("shell", "settings", "delete", "system", "screen_off_timeout")
      : adb("shell", "settings", "put", "system", "screen_off_timeout", previousScreenTimeout),
    () => broadcast("-e", "command", "exit"),
    () => previousDemo === "null"
      ? adb("shell", "settings", "delete", "global", "sysui_demo_allowed")
      : adb("shell", "settings", "put", "global", "sysui_demo_allowed", previousDemo),
    () => adb("reverse", "--remove", "tcp:4799"),
  ];
  for (const restore of cleanup) {
    try { restore(); } catch (error) { console.error("Android cleanup failed; see recovery steps in docs/readme-media.md:", error.message); }
  }
}
