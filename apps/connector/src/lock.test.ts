import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectorInstanceLock } from "./lock.js";

const directories: string[] = [];

async function lockPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-lock-"));
  directories.push(directory);
  return path.join(directory, "connector.lock");
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("connector instance lock", () => {
  it("prevents two connector processes from owning one pairing", async () => {
    const file = await lockPath();
    const first = await ConnectorInstanceLock.acquire(file);
    await expect(ConnectorInstanceLock.acquire(file)).rejects.toThrow(
      "already running",
    );
    await first.release();
    const second = await ConnectorInstanceLock.acquire(file);
    await second.release();
  });

  it("reclaims a stale process lock", async () => {
    const file = await lockPath();
    await writeFile(file, '{"pid":999999999,"startedAt":"old"}\n');
    const lock = await ConnectorInstanceLock.acquire(file);
    await lock.release();
  });

  it("recovers a reclaim guard abandoned by a dead owner", async () => {
    const file = await lockPath();
    await writeFile(file, '{"pid":999999999,"startedAt":"old"}\n');
    await writeFile(
      `${file}.reclaim`,
      '{"pid":999999998,"startedAt":"old","ownerId":"abandoned"}\n',
    );

    const lock = await ConnectorInstanceLock.acquire(file);
    await lock.release();
  });

  it("never steals a live process lock while cleaning a stale guard", async () => {
    const file = await lockPath();
    const first = await ConnectorInstanceLock.acquire(file);
    const firstRecord = await readFile(file, "utf8");
    await writeFile(
      `${file}.reclaim`,
      '{"pid":999999998,"startedAt":"old","ownerId":"abandoned"}\n',
    );

    await expect(ConnectorInstanceLock.acquire(file)).rejects.toThrow(
      "already running",
    );
    await expect(readFile(file, "utf8")).resolves.toBe(firstRecord);
    await first.release();
  });

  it("recovers an old malformed reclaim guard but preserves a live one", async () => {
    const file = await lockPath();
    const reclaimFile = `${file}.reclaim`;
    await writeFile(file, '{"pid":999999999,"startedAt":"old"}\n');
    await writeFile(reclaimFile, "");
    const old = new Date(Date.now() - 60_000);
    await utimes(reclaimFile, old, old);

    const lock = await ConnectorInstanceLock.acquire(file);
    await lock.release();

    await writeFile(file, '{"pid":999999999,"startedAt":"old"}\n');
    await writeFile(
      reclaimFile,
      `${JSON.stringify({
        pid: process.pid,
        startedAt: new Date(0).toISOString(),
        ownerId: "live-owner",
      })}\n`,
    );
    await expect(ConnectorInstanceLock.acquire(file)).rejects.toThrow(
      "already running",
    );
    await expect(readFile(file, "utf8")).resolves.toContain("999999999");
  });

  it("does not remove a replacement lock it no longer owns", async () => {
    const file = await lockPath();
    const lock = await ConnectorInstanceLock.acquire(file);
    await rm(file);
    await writeFile(
      file,
      `${JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        ownerId: "replacement-owner",
      })}\n`,
    );

    await lock.release();
    await expect(readFile(file, "utf8")).resolves.toContain(
      "replacement-owner",
    );
  });

  it("does not steal a freshly-created lock before its owner writes it", async () => {
    const file = await lockPath();
    await writeFile(file, "");
    await expect(ConnectorInstanceLock.acquire(file)).rejects.toThrow(
      "already running",
    );
  });

  it("lets only one contender reclaim an abandoned lock", async () => {
    const file = await lockPath();
    await writeFile(file, '{"pid":999999999,"startedAt":"old"}\n');
    const contenders = await Promise.allSettled([
      ConnectorInstanceLock.acquire(file),
      ConnectorInstanceLock.acquire(file),
    ]);
    const acquired = contenders.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    expect(acquired).toHaveLength(1);
    await acquired[0]!.release();
  });
});
