// Inspect the packaged executable and ASAR, including copies extracted from downloads.
import assert from "node:assert/strict";
import { log } from "node:console";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { extractFile, listPackage } from "@electron/asar";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { FuseState } from "@electron/fuses/dist/constants.js";

const [directory] = process.argv.slice(2);
assert(directory && process.argv.length === 3,
  "Usage: node verify-desktop-linux.mjs app-directory");
const executable = path.join(directory, "overtchat-desktop");
const header = readFileSync(executable).subarray(0, 20);
assert.equal(header.subarray(0, 4).toString("hex"), "7f454c46", "Expected ELF executable");
assert.equal(header[4], 2, "Expected 64-bit ELF");
assert.equal(header[5], 1, "Expected little-endian ELF");
assert.equal(header.readUInt16LE(18), 62, "Expected x86-64 executable");
const archive = path.join(directory, "resources/app.asar");
const files = listPackage(archive);
for (const file of ["/out/main/index.js", "/out/preload/index.cjs", "/out/renderer/index.html", "/package.json"]) {
  assert(files.includes(file), `Missing packaged file: ${file}`);
}
assert(files.every(file => file === "/package.json" || file === "/out" || file.startsWith("/out/")),
  "Unexpected packaged files");
const metadata = JSON.parse(extractFile(archive, "package.json").toString());
const expected = JSON.parse(readFileSync("apps/desktop/package.json", "utf8"));
assert.equal(metadata.name, expected.name);
assert.equal(metadata.version, expected.version);
assert.equal(metadata.main, expected.main);
const fuses = await getCurrentFuseWire(executable);
for (const fuse of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable,
  FuseV1Options.EnableNodeCliInspectArguments]) {
  assert.equal(fuses[fuse], FuseState.DISABLE);
}
// Linux Electron does not enforce embedded ASAR integrity; these flags do not
// substitute for verifying downloaded artifacts and their published checksums.
for (const fuse of [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]) {
  assert.equal(fuses[fuse], FuseState.ENABLE);
}
log(`Verified Linux x64 bundle: ${metadata.version} (${directory})`);
