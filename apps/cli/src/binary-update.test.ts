import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { BinaryUpdate } from "./binary-update.js";
import { ProcessLock } from "./process-lock.js";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it.each(["prepared", "backup", "replacement", "committed"])("recovers actual process death at %s", async point => {
  const root = await mkdtemp(path.join(os.tmpdir(), "interrupted-update-"));
  directories.push(root);
  const target = path.join(root, "overtchat.exe");
  await writeFile(target, "last known good");
  await writeFile(path.join(root, "candidate"), "new candidate");
  const child = fork(fileURLToPath(new URL("./test-support/interrupted-update.ts", import.meta.url)), [root, point], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr?.on("data", chunk => stderr += chunk);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("message", () => resolve());
      child.once("exit", code => reject(new Error(`Worker exited ${code}: ${stderr}`)));
      child.once("error", reject);
    });
    await expect(ProcessLock.acquire(`${target}.update.lock`)).rejects.toThrow("Another OvertChat installation operation");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    // A new process can reclaim the dead owner's lock without deleting live locks.
    const lock = await ProcessLock.acquire(`${target}.update.lock`);
    try {
      const recovery = new BinaryUpdate(target);
      expect(await recovery.pending()).toBe(true);
      if (!recovery.committed) await recovery.restore();
      await recovery.finish();
      expect(await readFile(target, "utf8")).toBe(point === "committed" ? "new candidate" : "last known good");
      await expect(stat(`${target}.update.json`)).rejects.toMatchObject({ code: "ENOENT" });
      // Recovery itself is idempotent.
      expect(await new BinaryUpdate(target).pending()).toBe(false);
    } finally { await lock.release(); }
  } finally { child.kill("SIGKILL"); }
}, 20_000);

it("never overwrites an unjournaled recovery backup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "legacy-update-"));
  directories.push(root);
  const target = path.join(root, "overtchat.exe");
  await writeFile(`${target}.previous`, "only known good copy");
  await writeFile(path.join(root, "candidate"), "candidate");
  await expect(new BinaryUpdate(target).prepare(path.join(root, "candidate"))).rejects.toThrow("previous update backup exists");
  expect(await readFile(`${target}.previous`, "utf8")).toBe("only known good copy");
});
