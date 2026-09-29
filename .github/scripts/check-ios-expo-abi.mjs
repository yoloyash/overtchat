#!/usr/bin/env node
// Inspect the binaries that will ship, including Release-only native imports.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import console from "node:console";
import { readdirSync, existsSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function exportedSymbols(output) {
  assert.match(output, /-exports:/, "Missing dyld export table");
  const symbols = new Set();
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*0x[\da-f]+\s+(\S+)/i);
    if (match) symbols.add(match[1]);
  }
  assert(symbols.size > 0, "ExpoModulesCore has no readable exports");
  return symbols;
}

export function requiredCoreSymbols(output) {
  assert.match(output, /-fixups:/, "Missing dyld fixup table");
  const symbols = new Set();
  for (const line of output.split("\n")) {
    if (line.includes("[weak-import]")) continue;
    const match = line.match(/\bbind\s+ExpoModulesCore\/(\S+)/);
    if (match) symbols.add(match[1]);
  }
  return symbols;
}

export function missingCoreSymbols(fixups, exports) {
  return [...requiredCoreSymbols(fixups)].filter((symbol) => !exports.has(symbol));
}

function inspect(binary, table) {
  // Tool errors fail the release gate instead of silently skipping validation.
  return execFileSync("xcrun", ["dyld_info", "-arch", "arm64", table, binary], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function executable(bundle) {
  const name = execFileSync("plutil", [
    "-extract", "CFBundleExecutable", "raw", "-o", "-", path.join(bundle, "Info.plist"),
  ], { encoding: "utf8" }).trim();
  assert(name && path.basename(name) === name, `Invalid executable in ${bundle}`);
  return path.join(bundle, name);
}

export function checkApp(app) {
  const frameworks = path.join(app, "Frameworks");
  const binaries = [executable(app)];
  if (existsSync(frameworks)) {
    for (const entry of readdirSync(frameworks)) {
      if (entry.endsWith(".framework")) binaries.push(executable(path.join(frameworks, entry)));
      else if (entry.endsWith(".dylib")) binaries.push(path.join(frameworks, entry));
    }
  }
  const core = binaries.find((binary) => path.basename(binary) === "ExpoModulesCore");
  // A source-linked app can have no dynamic core; any remaining imports are invalid.
  const exports = core ? exportedSymbols(inspect(core, "-exports")) : new Set();
  const failures = [];
  for (const binary of binaries) {
    if (binary === core) continue;
    const missing = missingCoreSymbols(inspect(binary, "-fixups"), exports);
    if (missing.length) {
      failures.push(`${path.relative(app, binary)} requires missing ExpoModulesCore symbols:\n${missing.map((symbol) => `  ${symbol}`).join("\n")}`);
    }
  }
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(`Verified ExpoModulesCore ABI in ${binaries.length} shipped arm64 binaries`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  assert(process.argv[2], "Usage: check-ios-expo-abi.mjs path/to/App.app");
  checkApp(path.resolve(process.argv[2]));
}
