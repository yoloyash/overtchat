import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Run with Node 22 --import tsx on a signed-in Windows desktop. The connector
// executable, NTFS operations, and scheduled task are real. Only a partial-copy
// error and the management HTTP response are injected, inside an isolated root.
assert.equal(process.platform, "win32");
const binary = path.resolve(process.argv[2]);
const exec = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "OvertChat rollback "));
const installed = path.join(root, "bin", "overtchat-connector.exe");
const config = path.join(root, "config", "connector.json");
const running = path.join(path.dirname(config), "windows-service", "running.json");
const originalCopy = fs.copyFile;
const originalFetch = globalThis.fetch;
let fault;
Object.assign(process.env, {
  OVERTCHAT_BIN_DIR: path.dirname(installed),
  OVERTCHAT_CONFIG_DIR: path.dirname(config),
  OVERTCHAT_CONNECTOR_CONFIG: config,
  OVERTCHAT_CONNECTOR_BINARY: binary,
});
for (const key of ["OVERTCHAT_CONNECTOR_STATE", "OVERTCHAT_CONNECTOR_TIMELINES", "OVERTCHAT_CONNECTOR_LOCK"]) delete process.env[key];
const invoke = (command, input) => new Promise((resolve, reject) => {
  const child = execFile(installed, [command], { windowsHide: true, timeout: 120_000 }, (error, stdout, stderr) => {
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
  await fs.mkdir(path.dirname(installed), { recursive: true });
  await originalCopy(binary, installed);
  const version = (await exec(binary, ["version"])).stdout.trim();
  await invoke("install-managed", JSON.stringify({
    serverUrl: "http://127.0.0.1:49991", connectorId: "rollback_fixture",
    token: "oct_rollback_fixture.disposable-test-only",
  }));
  let instance = await waitForInstance();
  const expectedBinary = await fs.readFile(binary);
  const expectedConfig = await fs.readFile(config);
  fs.copyFile = async (source, destination, ...args) => {
    if (fault === "copy" && path.resolve(destination) === installed) {
      await fs.writeFile(destination, "incomplete executable");
      throw Object.assign(new Error("Injected disk full during copy"), { code: "ENOSPC" });
    }
    return originalCopy(source, destination, ...args);
  };
  syncBuiltinESMExports();
  globalThis.fetch = async () => {
    assert.equal(fault, "provision", "Copy failure must happen before provisioning");
    return new Response(JSON.stringify({ error: "Injected provisioning failure" }), { status: 503 });
  };
  const { installManagedConnector } = await import("../../apps/cli/src/connector.ts");
  for (fault of ["copy", "provision"]) {
    await assert.rejects(
      installManagedConnector({ appPort: 49991, connectorVersion: version }, "fixture-management-secret"),
      fault === "copy" ? /Injected disk full during copy/ : /Injected provisioning failure/,
    );
    assert.deepEqual(await fs.readFile(installed), expectedBinary);
    assert.deepEqual(await fs.readFile(config), expectedConfig);
    instance = await waitForInstance(instance.nonce);
    assert.equal((await invoke("version")).trim(), version);
    await assert.rejects(fs.stat(`${installed}.previous`), { code: "ENOENT" });
    console.log(`PASS: ${fault} failure restored original executable, credentials, and running scheduled task`);
  }
} finally {
  fs.copyFile = originalCopy;
  syncBuiltinESMExports();
  globalThis.fetch = originalFetch;
  // Stop using the known-good candidate even if a regression left the installed
  // executable incomplete. The config override limits cleanup to this fixture.
  await exec(binary, ["service-uninstall"], { windowsHide: true, timeout: 120_000 });
  await fs.rm(root, { recursive: true, force: true });
}
