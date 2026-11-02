import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { pruneConnectorRuntimes, stageConnectorPackage } from "./connector-package.js";

const posix = it.skipIf(process.platform === "win32");
const windows = it.runIf(process.platform === "win32");
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  // Windows releases a just-exited executable's image asynchronously.
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 10 });
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "connector-package-test-"));
  directories.push(directory);
  const home = path.join(directory, "home with ' quote");
  vi.spyOn(os, "homedir").mockReturnValue(home);
  const root = path.join(directory, "overtchat-connector");
  const staged = path.join(directory, "staged");
  await mkdir(root);
  await mkdir(staged);
  await writeFile(path.join(root, "overtchat-connector"), `#!/bin/sh
if [ "$1" = version ]; then echo 1.2.3; else printf '%s\\n' "$OVERTCHAT_CONNECTOR_LAUNCHER" "$@"; fi
`, { mode: 0o755 });
  const archive = path.join(directory, "runtime.tar.gz");
  const pack = (member = "overtchat-connector") => execFileSync("tar", ["-czf", archive, "-C", directory, member]);
  return { directory, home, root, archive, staged, pack };
}

posix("stages a runtime independently of temporary downloads and preserves launcher arguments", async () => {
  const f = await fixture();
  f.pack();
  const { binary, payloadDirectory } = await stageConnectorPackage(f.archive, f.staged, "1.2.3");
  expect(payloadDirectory.startsWith(f.home)).toBe(true);
  expect(await readFile(binary, "utf8")).toContain("OVERTCHAT_CONNECTOR_LAUNCHER");
  await rm(f.archive);
  expect(execFileSync(binary, ["command", "argument with spaces", "'quote"], { encoding: "utf8" }))
    .toBe(`${binary}\ncommand\nargument with spaces\n'quote\n`);
});

posix("rejects a runtime with an unexpected version before promoting a launcher", async () => {
  const f = await fixture();
  f.pack();
  await expect(stageConnectorPackage(f.archive, f.staged, "9.9.9")).rejects.toThrow("version check");
  expect(await readdir(f.staged)).toEqual([]);
  expect(await readdir(path.join(f.home, ".local/lib/overtchat/connector"))).toEqual([]);
});

posix("rejects archive members outside the package directory", async () => {
  const f = await fixture();
  await writeFile(path.join(f.directory, "outside"), "unexpected");
  f.pack("outside");
  await expect(stageConnectorPackage(f.archive, f.staged, "1.2.3")).rejects.toThrow("invalid path");
});

posix("rejects symlinks before extracting a package", async () => {
  const f = await fixture();
  await symlink("/tmp", path.join(f.root, "escape"));
  f.pack();
  await expect(stageConnectorPackage(f.archive, f.staged, "1.2.3")).rejects.toThrow("unsupported links");
});

posix("prunes only runtimes that no launcher references, including quoted paths", async () => {
  const f = await fixture();
  f.pack();
  const { binary, payloadDirectory } = await stageConnectorPackage(f.archive, f.staged, "1.2.3");
  await pruneConnectorRuntimes([binary, path.join(f.directory, "missing")]);
  expect(await readdir(path.dirname(payloadDirectory))).toEqual([path.basename(payloadDirectory)]);
  await pruneConnectorRuntimes([]);
  expect(await readdir(path.dirname(payloadDirectory))).toEqual([]);
});

windows("stages a Windows runtime whose batch launcher survives cmd.exe path syntax", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "connector-package-test-"));
  directories.push(directory);
  vi.stubEnv("OVERTCHAT_BIN_DIR", path.join(directory, "100% & (more)", "bin"));
  const root = path.join(directory, "overtchat-connector");
  await mkdir(path.join(root, "bin"), { recursive: true });
  await mkdir(path.join(root, "app"));
  await copyFile(process.execPath, path.join(root, "bin", "node.exe"));
  await writeFile(path.join(root, "app", "connector.mjs"),
    "if (process.argv[2] === 'version') console.log('1.2.3'); else { console.log(process.argv.slice(2).join('|')); process.exitCode = 7; }");
  const archive = path.join(directory, "runtime.tar.gz");
  execFileSync(path.join(process.env.SystemRoot!, "System32", "tar.exe"), ["-czf", archive, "-C", directory, "overtchat-connector"]);
  const staged = path.join(directory, "staged");
  await mkdir(staged);
  try {
    const { binary, payloadDirectory } = await stageConnectorPackage(archive, staged, "1.2.3");
    expect(payloadDirectory.startsWith(path.join(directory, "100% & (more)", "connector"))).toBe(true);
    const result = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${binary}" service-stop run"`], {
      encoding: "utf8", windowsVerbatimArguments: true,
    });
    expect(result.stdout.trim()).toBe("service-stop|run");
    expect(result.status).toBe(7);
  } finally { vi.unstubAllEnvs(); }
}, 60_000);
