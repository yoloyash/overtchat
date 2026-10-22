/* global AbortSignal, Buffer, console, fetch, process, URL */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const runtime = JSON.parse(await readFile(new URL("./node-runtime.json", import.meta.url), "utf8"));
const metadata = JSON.parse(await readFile(path.join(workspace, "package.json"), "utf8"));
const { values } = parseArgs({ options: {
  target: { type: "string", default: `${process.platform}-${process.arch}` },
  output: { type: "string", default: path.join(workspace, "dist", "release") },
} });
const target = values.target;
assert(Object.hasOwn(runtime.sha256, target), `Unsupported connector target: ${target}`);
const assetTarget = target.replace(/-x64$/, "-amd64");
const output = path.resolve(values.output);
const staging = await mkdtemp(path.join(os.tmpdir(), "overtchat-connector-package-"));
const root = path.join(staging, "overtchat-connector");

try {
  await mkdir(path.join(root, "bin"), { recursive: true });
  const nodeArchive = `node-v${runtime.version}-${target}.tar.gz`;
  const cache = path.join(workspace, "dist", "node-runtime-cache");
  await mkdir(cache, { recursive: true });
  let bytes = await readFile(path.join(cache, nodeArchive)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (!bytes) {
    const response = await fetch(`https://nodejs.org/dist/v${runtime.version}/${nodeArchive}`, {
      signal: AbortSignal.timeout(120_000),
    });
    assert(response.ok, `Node download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), runtime.sha256[target], "Node runtime checksum mismatch");
    await writeFile(path.join(cache, nodeArchive), bytes);
  }
  assert.equal(createHash("sha256").update(bytes).digest("hex"), runtime.sha256[target], "Node runtime checksum mismatch");
  await writeFile(path.join(staging, nodeArchive), bytes);
  execFileSync("tar", ["-xzf", path.join(staging, nodeArchive), "-C", staging]);
  const nodeRoot = path.join(staging, `node-v${runtime.version}-${target}`);
  await copyFile(path.join(nodeRoot, "bin", "node"), path.join(root, "bin", "node"));
  await copyFile(path.join(nodeRoot, "LICENSE"), path.join(root, "NODE-LICENSE"));
  await chmod(path.join(root, "bin", "node"), 0o755);

  await build({
    absWorkingDir: workspace,
    entryPoints: ["src/cli.ts"],
    outfile: path.join(root, "app", "connector.mjs"),
    bundle: true, platform: "node", target: "node22", format: "esm",
    external: ["node-pty", "node-pty/*"],
    banner: { js: "import { createRequire as __overtchatCreateRequire } from 'node:module'; const require = __overtchatCreateRequire(import.meta.url);" },
  });
  // Native addons stay external and use their normal package-relative loader.
  const ptyRoot = path.dirname(require.resolve("node-pty/package.json"));
  const ptyDestination = path.join(root, "node_modules", "node-pty");
  await mkdir(ptyDestination, { recursive: true });
  await copyFile(path.join(ptyRoot, "package.json"), path.join(ptyDestination, "package.json"));
  await cp(path.join(ptyRoot, "lib"), path.join(ptyDestination, "lib"), {
    recursive: true,
    filter: (source) => !source.endsWith(".map") && !source.endsWith(".test.js"),
  });
  await cp(path.join(ptyRoot, "prebuilds", target), path.join(ptyDestination, "prebuilds", target), { recursive: true });
  if (target.startsWith("darwin-")) {
    await chmod(path.join(ptyDestination, "prebuilds", target, "spawn-helper"), 0o755);
  }
  // Preserve npm package license material when it is included by the publisher.
  for (const name of ["LICENSE", "LICENSE.txt"]) {
    await copyFile(path.join(ptyRoot, name), path.join(ptyDestination, name)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: metadata.name, version: metadata.version, private: true,
    overtchatConnector: { format: 1, node: runtime.version, target, pty: metadata.dependencies["node-pty"] },
  }, null, 2) + "\n");
  await writeFile(path.join(root, "overtchat-connector"), `#!/bin/sh
set -eu
connector_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$connector_root/bin/node" "$connector_root/app/connector.mjs" "$@"
`, { mode: 0o755 });
  await mkdir(output, { recursive: true });
  const archive = path.join(output, `overtchat-connector-${assetTarget}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", staging, "overtchat-connector"]);
  const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
  await writeFile(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`);
  console.log(`Packaged ${path.basename(archive)} with Node ${runtime.version} and node-pty ${metadata.dependencies["node-pty"]}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
