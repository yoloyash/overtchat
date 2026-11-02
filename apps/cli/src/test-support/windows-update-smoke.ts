import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { updateCliIfNeeded, type ReleaseManifest } from "../release.js";
import { runCommand } from "../process.js";

// Compile this as overtchat.exe, then run it with the candidate fixture path.
// The production updater replaces this running image: mocks cannot establish
// Windows' rename/locking behavior. Only the download transport is substituted.
assert.equal(process.platform, "win32");
const before = await readFile(process.execPath);
const candidate = await readFile(process.argv[2]!);
const hash = createHash("sha256").update(candidate).digest("hex");
let corrupt = true;
globalThis.fetch = (async (input: string | URL | Request) => new Response(
  String(input).endsWith("overtchat-checksums.txt")
    ? `${corrupt ? "0".repeat(64) : hash}  overtchat-windows-amd64.exe\n`
    : candidate,
)) as typeof fetch;
const manifest = { cliVersion: "99.0.0" } as ReleaseManifest;
await assert.rejects(updateCliIfNeeded(manifest), /checksum verification/);
assert.deepEqual(await readFile(process.execPath), before);
corrupt = false;
assert.equal(await updateCliIfNeeded(manifest), process.execPath);
assert.deepEqual(await readFile(process.execPath), candidate);
const backups = (await readdir(path.dirname(process.execPath)))
  .filter((name) => name === "overtchat.exe.previous");
assert.equal(backups.length, 1);
assert.deepEqual(await readFile(path.join(path.dirname(process.execPath), backups[0]!)), before);
const next = await runCommand(process.execPath, ["version"]);
assert.equal(next.exitCode, 0);
assert.equal(next.stdout.trim(), "99.0.0");
console.log("PASS: native self-update rejects corrupt download, replaces running executable, retains recovery image, and launches replacement.");
