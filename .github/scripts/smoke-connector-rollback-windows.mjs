import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Run with Node 22 --import tsx on a signed-in Windows desktop. The connector
// package, NTFS operations, and scheduled task are real. Only a partial-copy
// error and management readiness are injected, inside an isolated root.
assert.equal(process.platform, "win32");
const archive = path.resolve(process.argv[2]);
const exec = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "OvertChat rollback "));
const installed = path.join(root, "bin", "overtchat-connector.cmd");
const runtimes = path.join(root, "connector");
const extracted = path.join(root, "package");
const node = path.join(extracted, "overtchat-connector", "bin", "node.exe");
const entry = path.join(extracted, "overtchat-connector", "app", "connector.mjs");
const config = path.join(root, "config", "connector.json");
const running = path.join(path.dirname(config), "windows-service", "running.json");
const originalCopy = fs.copyFile;
const originalFetch = globalThis.fetch;
let fault;
Object.assign(process.env, {
  OVERTCHAT_BIN_DIR: path.dirname(installed),
  OVERTCHAT_CONFIG_DIR: path.dirname(config),
  OVERTCHAT_CONNECTOR_CONFIG: config,
  OVERTCHAT_CONNECTOR_PACKAGE: archive,
});
for (const key of ["OVERTCHAT_CONNECTOR_STATE", "OVERTCHAT_CONNECTOR_TIMELINES", "OVERTCHAT_CONNECTOR_LOCK"]) delete process.env[key];
// Batch launchers run through cmd.exe, as the manager runs them.
const invoke = (command, input) => new Promise((resolve, reject) => {
  const child = execFile(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${installed}" ${command}"`], {
    windowsHide: true, timeout: 120_000, windowsVerbatimArguments: true,
  }, (error, stdout, stderr) => {
    if (error) reject(new Error(`${command} failed: ${stderr || error.message}`));
    else resolve(stdout);
  });
  child.stdin.end(input);
});
async function waitForInstance(previousNonce) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const state = await fs.readFile(running, "utf8").then(JSON.parse).catch(() => null);
    if (state && state.nonce !== previousNonce) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Restored connector task did not start a new instance");
}
try {
  await fs.mkdir(extracted);
  await exec(path.join(process.env.SystemRoot, "System32", "tar.exe"), ["-xzf", archive, "-C", extracted]);
  const version = (await exec(node, [entry, "version"])).stdout.trim();
  await fs.mkdir(path.dirname(config), { recursive: true });
  await fs.writeFile(config, JSON.stringify({
    serverUrl: "http://127.0.0.1:49991", connectorId: "rollback_fixture",
    token: "oct_rollback_fixture.disposable-test-only",
  }));
  globalThis.fetch = async (_url, options) => {
    assert.notEqual(options?.method, "PUT", "An update must not rotate pairing credentials");
    return Response.json({ connector: { id: "rollback_fixture", version, online: true } });
  };
  const { installManagedConnector } = await import("../../apps/cli/src/connector.ts");
  await installManagedConnector({ appPort: 49991, connectorVersion: version }, "fixture-management-secret");
  let instance = await waitForInstance();
  const expectedBinary = await fs.readFile(installed);
  const expectedConfig = await fs.readFile(config);
  assert.equal((await fs.readdir(runtimes)).length, 1);
  fs.copyFile = async (source, destination, ...args) => {
    if (fault === "copy" && path.resolve(destination) === `${installed}.next`) {
      await fs.writeFile(destination, "incomplete executable");
      throw Object.assign(new Error("Injected disk full during copy"), { code: "ENOSPC" });
    }
    return originalCopy(source, destination, ...args);
  };
  syncBuiltinESMExports();
  for (fault of ["copy", "startup"]) {
    await assert.rejects(
      installManagedConnector({ appPort: fault === "startup" ? 70000 : 49991, connectorVersion: version }, "fixture-management-secret"),
      fault === "copy" ? /Injected disk full during copy/ : /Starting Agent Connector service/,
    );
    assert.deepEqual(await fs.readFile(installed), expectedBinary);
    assert.deepEqual(await fs.readFile(config), expectedConfig);
    if (fault === "copy") assert.equal((await waitForInstance()).nonce, instance.nonce, "Staging failure must not stop the old service");
    else instance = await waitForInstance(instance.nonce);
    assert.equal((await invoke("version")).trim(), version);
    await assert.rejects(fs.stat(`${installed}.previous`), { code: "ENOENT" });
    assert.equal((await fs.readdir(runtimes)).length, 1, "The failed candidate runtime must be removed");
    console.log(`PASS: ${fault} failure preserved/restored launcher, runtime, credentials, and running scheduled task (readiness fixture)`);
  }
  fault = undefined;
  const [previousRuntime] = await fs.readdir(runtimes);
  await installManagedConnector({ appPort: 49991, connectorVersion: version }, "fixture-management-secret");
  instance = await waitForInstance(instance.nonce);
  const [currentRuntime, ...others] = await fs.readdir(runtimes);
  assert.deepEqual(others, [], "A successful update must remove the stopped runtime");
  assert.notEqual(currentRuntime, previousRuntime);
  assert.equal((await invoke("version")).trim(), version);
  // The task runs the packaged runtime directly, without cmd.exe in between.
  const task = await fs.readFile(path.join(path.dirname(running), "connector.ps1"), "utf8");
  assert(task.includes(path.join(runtimes, currentRuntime, "overtchat-connector", "bin", "node.exe")));
  console.log("PASS: update replaced the running connector and removed its previous runtime");
} finally {
  fs.copyFile = originalCopy;
  syncBuiltinESMExports();
  globalThis.fetch = originalFetch;
  // Stop using the known-good package even if a regression left the installed
  // launcher incomplete. The config override limits cleanup to this fixture.
  await exec(node, [entry, "service-uninstall"], { windowsHide: true, timeout: 120_000 });
  await fs.rm(root, { recursive: true, force: true });
}
