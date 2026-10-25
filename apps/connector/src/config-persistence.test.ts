import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { readConnectorConfig, writeConnectorConfig } from "./config.js";
const faults = vi.hoisted(() => ({ point: "" }));
vi.mock("node:fs/promises", async original => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rename: async (...args: Parameters<typeof fs.rename>) => {
    if (faults.point === "rename") throw new Error("rename denied");
    return fs.rename(...args);
  }, open: async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args);
    if (faults.point === "write" && args[1] === "wx") {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async () => { await write('{"partial":'); throw new Error("disk full"); };
    }
    if (faults.point === "sync" && args[1] === "wx") handle.sync = async () => { throw new Error("sync failed"); };
    return handle;
  } };
});
let root: string | undefined;
afterEach(async () => {
  faults.point = ""; vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});
it.each(["write", "sync", "rename"])("preserves the complete previous pairing on %s failure", async point => {
  root = await mkdtemp(path.join(os.tmpdir(), "connector-config-"));
  const file = path.join(root, "connector.json");
  vi.stubEnv("OVERTCHAT_CONNECTOR_CONFIG", file);
  const previous = { serverUrl: "http://localhost:4718", connectorId: "old", token: "oct_old.fixture" };
  await writeConnectorConfig(previous);
  faults.point = point;
  await expect(writeConnectorConfig({ ...previous, token: "oct_old.changed" })).rejects.toThrow();
  expect(await readConnectorConfig()).toEqual(previous);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(previous);
  expect(await readdir(root)).toEqual(["connector.json"]);
  faults.point = "";
  await writeConnectorConfig({ ...previous, token: "oct_old.changed" });
  expect((await readConnectorConfig()).token).toBe("oct_old.changed");
}, 15_000);
