import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { ProcessLock } from "../process-lock.js";

const [directory, point] = process.argv.slice(2);
const target = path.join(directory!, "overtchat.exe");
const lock = await ProcessLock.acquire(`${target}.update.lock`);
const pause = async () => {
  process.send?.("ready");
  await new Promise(() => { setInterval(() => {}, 1_000); });
};
const originalRename = fs.rename;
const originalRm = fs.rm;
fs.rename = async (source, destination) => {
  await originalRename(source, destination);
  if (point === "backup" && String(destination) === `${target}.previous`) await pause();
  if (point === "replacement" && String(destination) === target) await pause();
};
fs.rm = async (file, options) => {
  if (point === "committed" && String(file) === `${target}.previous`) await pause();
  return originalRm(file, options);
};
syncBuiltinESMExports();
const { BinaryUpdate } = await import("../binary-update.js");
const transaction = new BinaryUpdate(target);
await transaction.prepare(path.join(directory!, "candidate"));
if (point === "prepared") await pause();
await transaction.replace();
await transaction.commit();
await lock.release();
throw new Error("Did not reach the interruption point");
