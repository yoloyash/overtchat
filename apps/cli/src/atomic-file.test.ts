import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { atomicWrite } from "./atomic-file.js";

const faults = vi.hoisted(() => ({ busy: 0, code: "EBUSY" }));
vi.mock("node:fs/promises", async original => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rename: async (...args: Parameters<typeof fs.rename>) => {
    if (faults.busy > 0) {
      faults.busy -= 1;
      throw Object.assign(new Error("sharing violation"), { code: faults.code });
    }
    return fs.rename(...args);
  } };
});

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
let root: string | undefined;
afterEach(async () => {
  Object.defineProperty(process, "platform", platform);
  faults.busy = 0;
  faults.code = "EBUSY";
  if (root) await rm(root, { recursive: true, force: true });
});

it("retries a Windows replacement blocked by a scanner", async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "atomic-file-"));
  Object.defineProperty(process, "platform", { value: "win32" });
  faults.busy = 3;
  await atomicWrite(path.join(root, "installation.json"), "{}\n");
  expect(await readFile(path.join(root, "installation.json"), "utf8")).toBe("{}\n");
  expect(await readdir(root)).toEqual(["installation.json"]);
});

it("does not retry sharing violations outside Windows", async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "atomic-file-"));
  Object.defineProperty(process, "platform", { value: "linux" });
  faults.busy = 1;
  await expect(atomicWrite(path.join(root, "installation.json"), "{}\n")).rejects.toMatchObject({ code: "EBUSY" });
  expect(await readdir(root)).toEqual([]);
});
