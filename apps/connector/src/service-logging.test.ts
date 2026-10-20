import { Console } from "node:console";
import {
  closeSync, mkdtempSync, openSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync, writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { configureServiceLogging, rotatingLog } from "./service-logging.js";

const directories: string[] = [];
const descriptors: number[] = [];
afterEach(() => {
  for (const fd of descriptors.splice(0)) closeSync(fd);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function fixture(initial = "", maxBytes = 16) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "connector-logs-"));
  directories.push(directory);
  const file = path.join(directory, "connector.log");
  writeFileSync(file, initial, { mode: 0o600 });
  const fd = openSync(file, "a");
  descriptors.push(fd);
  return { directory, file, fd, output: rotatingLog(fd, file, maxBytes) };
}

it("rotates continuously and retains only the three most recent backups", () => {
  const { file, directory, output } = fixture();
  for (const value of ["a", "b", "c", "d", "e", "f"]) output.write(value.repeat(16));
  expect(readdirSync(directory).sort()).toEqual([
    "connector.log", "connector.log.1", "connector.log.2", "connector.log.3",
  ]);
  for (const [suffix, value] of [["", "f"], [".1", "e"], [".2", "d"], [".3", "c"]]) {
    expect(readFileSync(file + suffix, "utf8")).toBe(value.repeat(16));
  }
});

it("keeps launchd's descriptor attached to the active log after rotation", () => {
  const { file, fd, output } = fixture("a".repeat(16));
  const inode = statSync(file).ino;
  output.write("next");
  writeSync(fd, " native stderr");
  expect(statSync(file).ino).toBe(inode);
  expect(readFileSync(file, "utf8")).toBe("next native stderr");
  expect(readFileSync(`${file}.1`, "utf8")).toBe("a".repeat(16));
});

it("bounds oversized messages and existing logs without reading the entire old log", () => {
  const { file, directory, output } = fixture("old".repeat(100));
  expect(statSync(file).size).toBe(0);
  expect(statSync(`${file}.1`).size).toBe(16);
  output.write("x".repeat(1000));
  for (const name of readdirSync(directory)) {
    expect(statSync(path.join(directory, name)).size).toBeLessThanOrEqual(16);
  }
});

it("preserves separate console output and error logs", () => {
  const out = fixture("", 64);
  const err = fixture("", 64);
  const logger = new Console({ stdout: out.output, stderr: err.output });
  logger.log("connected %s", "server");
  logger.error("connection failed");
  expect(readFileSync(out.file, "utf8")).toBe("connected server\n");
  expect(readFileSync(err.file, "utf8")).toBe("connection failed\n");
});

it.each(["linux", "darwin"] as const)("leaves ordinary %s terminal logging alone", (platform) => {
  vi.spyOn(process, "platform", "get").mockReturnValue(platform);
  vi.stubEnv("XPC_SERVICE_NAME", platform === "linux" ? "com.overtchat.connector" : "0");
  const original = globalThis.console;
  configureServiceLogging();
  expect(globalThis.console).toBe(original);
});
