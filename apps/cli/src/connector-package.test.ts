import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { stageConnectorPackage } from "./connector-package.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
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

it("stages a runtime independently of temporary downloads and preserves launcher arguments", async () => {
  const f = await fixture();
  f.pack();
  const { binary, payloadDirectory } = await stageConnectorPackage(f.archive, f.staged, "1.2.3");
  expect(payloadDirectory.startsWith(f.home)).toBe(true);
  expect(await readFile(binary, "utf8")).toContain("OVERTCHAT_CONNECTOR_LAUNCHER");
  await rm(f.archive);
  expect(execFileSync(binary, ["command", "argument with spaces", "'quote"], { encoding: "utf8" }))
    .toBe(`${binary}\ncommand\nargument with spaces\n'quote\n`);
});

it("rejects a runtime with an unexpected version before promoting a launcher", async () => {
  const f = await fixture();
  f.pack();
  await expect(stageConnectorPackage(f.archive, f.staged, "9.9.9")).rejects.toThrow("version check");
  expect(await readdir(f.staged)).toEqual([]);
  expect(await readdir(path.join(f.home, ".local/lib/overtchat/connector"))).toEqual([]);
});

it("rejects archive members outside the package directory", async () => {
  const f = await fixture();
  await writeFile(path.join(f.directory, "outside"), "unexpected");
  f.pack("outside");
  await expect(stageConnectorPackage(f.archive, f.staged, "1.2.3")).rejects.toThrow("invalid path");
});

it("rejects symlinks before extracting a package", async () => {
  const f = await fixture();
  await symlink("/tmp", path.join(f.root, "escape"));
  f.pack();
  await expect(stageConnectorPackage(f.archive, f.staged, "1.2.3")).rejects.toThrow("unsupported links");
});
