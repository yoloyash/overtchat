import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { exportedSymbols, missingCoreSymbols } from "./check-ios-expo-abi.mjs";

// The first symbol is the exact strong import in rejected 1.9.0 (18).
const record = "_$s15ExpoModulesCore6RecordPAAE4from10dictionary10appContextxSDySSypG_AA03AppH0CtKFZ";
// Core also owns witnesses on foreign types; Swift module-prefix matching misses them.
const witness = "_$s10Foundation3URLV15ExpoModulesCore11AnyArgumentADWP";
const fixups = `Camera [arm64]:
    -fixups:
        segment         section          address             type   target
        __DATA_CONST    __got            0x000403A0           bind  ExpoModulesCore/${witness}
        __DATA_CONST    __got            0x000403A8           bind  ExpoModulesCore/${record}
        __DATA_CONST    __got            0x000403B0           bind  ExpoModulesCore/${record}
        __DATA_CONST    __got            0x000403B8           bind  ExpoModulesCore/_optional [weak-import]
        __DATA_CONST    __got            0x000403C0           bind  Foundation/_unrelated
        __DATA_CONST    __got            0x000403C8         rebase  0x00035D2C
`;

test("rejects the shipped camera/core mismatch, deduplicating missing symbols", () => {
  const exports = exportedSymbols(`Core [arm64]:\n -exports:\n 0x0012E898 ${witness}\n`);
  assert.deepEqual(missingCoreSymbols(fixups, exports), [record]);
});

test("accepts compatible symbols and ignores optional and other-library imports", () => {
  const exports = exportedSymbols(`Core [arm64]:\n -exports:\n 0x0012E898 ${witness}\n 0x00041A20 ${record}\n`);
  assert.deepEqual(missingCoreSymbols(fixups, exports), []);
});

test("checks foreign-type witnesses and rejects imports when core is absent", () => {
  assert.deepEqual(missingCoreSymbols(fixups, new Set()), [witness, record]);
});

test("permits source-linked binaries with no dynamic core imports", () => {
  assert.deepEqual(missingCoreSymbols("App [arm64]:\n -fixups:\n", new Set()), []);
});

test("fails closed on missing or unreadable inspection output", () => {
  assert.throws(() => exportedSymbols(""), /Missing dyld export table/);
  assert.throws(() => exportedSymbols("-exports:"), /no readable exports/);
  assert.throws(() => missingCoreSymbols("", new Set()), /Missing dyld fixup table/);
});

test("executes the CLI through a symlink instead of silently skipping the gate", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ios-abi-test-"));
  try {
    const script = path.join(directory, "check.mjs");
    symlinkSync(fileURLToPath(new URL("./check-ios-expo-abi.mjs", import.meta.url)), script);
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: check-ios-expo-abi/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
