// Verify both win-unpacked and the bundle recovered by the actual NSIS installer.
import assert from "node:assert/strict";
import { log } from "node:console";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { extractFile, listPackage } from "@electron/asar";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { FuseState } from "@electron/fuses/dist/constants.js";
import { parse } from "yaml";

const [directory, version] = process.argv.slice(2);
assert(directory, "Usage: node verify-desktop-windows.mjs app-directory [expected-version]");
const executable = path.join(directory, "overtchat.exe");
const bytes = readFileSync(executable);
assert.equal(bytes.subarray(0, 2).toString(), "MZ", "Expected a Windows executable");
const pe = bytes.readUInt32LE(0x3c);
assert.equal(bytes.subarray(pe, pe + 4).toString(), "PE\0\0");
assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, "Expected Windows x64");
const archive = path.join(directory, "resources/app.asar");
const files = listPackage(archive).map(file => file.replaceAll("\\", "/"));
for (const file of ["/out/main/index.js", "/out/preload/index.cjs", "/out/renderer/index.html", "/package.json"]) {
  assert(files.includes(file), `Missing packaged file: ${file}`);
}
assert(files.every(file => file === "/package.json" || file === "/out" || file.startsWith("/out/")), "Unexpected packaged files");
const metadata = JSON.parse(extractFile(archive, "package.json").toString());
const expected = JSON.parse(readFileSync("apps/desktop/package.json", "utf8"));
assert.equal(metadata.name, expected.name);
assert.equal(metadata.version, version ?? expected.version);
assert.equal(metadata.main, expected.main);
const fuses = await getCurrentFuseWire(executable);
for (const fuse of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.EnableNodeCliInspectArguments]) {
  assert.equal(fuses[fuse], FuseState.DISABLE);
}
for (const fuse of [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]) {
  assert.equal(fuses[fuse], FuseState.ENABLE);
}
const update = parse(readFileSync(path.join(directory, "resources/app-update.yml"), "utf8"));
assert.equal(update.provider, "generic");
assert.equal(update.url, version ? "http://127.0.0.1:4931/" : "https://updates.overtchat.com/desktop/");
log(`Verified Windows x64 bundle: ${metadata.version} (${directory})`);
