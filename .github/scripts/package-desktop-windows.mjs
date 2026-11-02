// Run after npm run package:windows. Publish only the installer and adapted feed;
// full downloads are used, so Builder's differential blockmaps stay private.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { CLIENT_API_LEVEL } from "../../packages/shared/src/ping.ts";
import { writeDesktopUpdateMetadata } from "./desktop-update-metadata.mjs";

assert.equal(process.platform, "win32");
assert.equal(process.arch, "x64");
const directory = "apps/desktop/release";
const { version } = JSON.parse(await readFile("apps/desktop/package.json", "utf8"));
if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, `desktop-v${version}`);
const result = spawnSync(process.execPath, [".github/scripts/verify-desktop-windows.mjs", path.join(directory, "win-unpacked")], { stdio: "inherit" });
assert.equal(result.status, 0, "Windows bundle verification failed");
const channel = await writeDesktopUpdateMetadata({ directory, version, apiLevel: CLIENT_API_LEVEL, platform: "windows", arch: "x64" });
const entries = [];
for (const file of [`overtchat-${version}-windows-x64.exe`, channel]) {
  entries.push(`${createHash("sha256").update(await readFile(path.join(directory, file))).digest("hex")}  ${file}`);
}
await writeFile(path.join(directory, "desktop-checksums-windows-x64.txt"), `${entries.join("\n")}\n`);
