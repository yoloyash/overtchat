// Verify the shipped bundle, rather than trusting build configuration alone.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { log } from "node:console";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { listPackage } from "@electron/asar";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { FuseState } from "@electron/fuses/dist/constants.js";

const [app, architecture, mode, expectedVersion] = process.argv.slice(2);
assert(app && ["arm64", "x64"].includes(architecture) &&
  ["adhoc", "signed", "notarized"].includes(mode),
"Usage: node verify-desktop-mac.mjs app.app arm64|x64 adhoc|signed|notarized [expected-version]");
assert(!expectedVersion || /^\d+\.\d+\.\d+$/.test(expectedVersion));

function run(command, args, input) {
  const result = spawnSync(command, args, { encoding: "utf8", input });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.error}`);
  return result.stdout;
}

const info = JSON.parse(run("plutil", ["-convert", "json", "-o", "-", path.join(app, "Contents/Info.plist")]));
const version = expectedVersion ?? JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
assert.equal(info.CFBundleIdentifier, "com.overtchat.desktop");
assert.equal(info.CFBundleShortVersionString, version);
assert.equal(info.CFBundleVersion, version);
assert.equal(info.LSMinimumSystemVersion, "13.0");
assert(info.NSMicrophoneUsageDescription);
const executable = path.join(app, "Contents/MacOS", info.CFBundleExecutable);
assert.equal(run("lipo", ["-archs", executable]).trim(), architecture === "x64" ? "x86_64" : architecture);
run("codesign", ["--verify", "--deep", "--strict", app]);

const files = listPackage(path.join(app, "Contents/Resources/app.asar"));
for (const file of ["/out/main/index.js", "/out/preload/index.cjs", "/out/renderer/index.html", "/package.json"]) {
  assert(files.includes(file), `Missing packaged file: ${file}`);
}
assert(files.every(file => file === "/package.json" || file === "/out" || file.startsWith("/out/")), "Unexpected packaged files");
const fuses = await getCurrentFuseWire(app);
for (const fuse of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable]) {
  assert.equal(fuses[fuse], FuseState.DISABLE);
}
for (const fuse of [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]) {
  assert.equal(fuses[fuse], FuseState.ENABLE);
}

if (mode !== "adhoc") {
  assert.equal(fuses[FuseV1Options.EnableNodeCliInspectArguments], FuseState.DISABLE);
  const signature = spawnSync("codesign", ["-dvv", app], { encoding: "utf8" });
  assert.equal(signature.status, 0);
  assert.match(signature.stderr, /^Authority=Developer ID Application: .+ \(C35DR2MHM7\)$/m);
  assert.match(signature.stderr, /^TeamIdentifier=C35DR2MHM7$/m);
  assert.match(signature.stderr, /^Timestamp=/m);
  assert.match(signature.stderr, /flags=.*\(runtime\)/);
  const entitlements = JSON.parse(run("plutil", ["-convert", "json", "-o", "-", "-"],
    run("codesign", ["-d", "--entitlements", ":-", app])));
  assert.equal(entitlements["com.apple.security.cs.allow-jit"], true);
  assert.equal(entitlements["com.apple.security.device.audio-input"], true);
  for (const entitlement of ["com.apple.security.get-task-allow", "get-task-allow",
    "com.apple.security.cs.disable-library-validation", "com.apple.security.cs.allow-unsigned-executable-memory"]) {
    assert(!entitlements[entitlement], `Unsafe release entitlement: ${entitlement}`);
  }
}
if (mode === "notarized") {
  run("xcrun", ["stapler", "validate", app]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
}
log(`Verified ${mode} macOS ${architecture} bundle: ${info.CFBundleIdentifier} ${version}`);
