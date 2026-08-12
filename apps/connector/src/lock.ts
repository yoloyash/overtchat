import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  rm,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

type LockRecord = {
  pid: number;
  startedAt: string;
  ownerId?: string;
};

type OwnedLockRecord = LockRecord & { ownerId: string };

type LockObservation = {
  raw: string;
  device: number;
  inode: number;
  modifiedAt: number;
  record: LockRecord | null;
};

const MALFORMED_LOCK_GRACE_MS = 30_000;

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseLockRecord(raw: string): LockRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<LockRecord>;
    if (
      typeof value.pid !== "number" ||
      typeof value.startedAt !== "string"
    ) {
      return null;
    }
    return value as LockRecord;
  } catch {
    return null;
  }
}

async function observeLock(file: string): Promise<LockObservation | null> {
  let handle: FileHandle;
  try {
    handle = await open(file, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const [raw, metadata] = await Promise.all([
      handle.readFile("utf8"),
      handle.stat(),
    ]);
    return {
      raw,
      device: metadata.dev,
      inode: metadata.ino,
      modifiedAt: metadata.mtimeMs,
      record: parseLockRecord(raw),
    };
  } finally {
    await handle.close();
  }
}

function sameLock(
  left: LockObservation,
  right: LockObservation,
): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.raw === right.raw
  );
}

function staleLock(observation: LockObservation): boolean {
  if (observation.record) {
    return !isProcessAlive(observation.record.pid);
  }
  // Do not steal the file during the tiny create-before-write window of a
  // process that just acquired it. A malformed file is reclaimable only
  // after it has clearly been abandoned.
  return Date.now() - observation.modifiedAt > MALFORMED_LOCK_GRACE_MS;
}

async function removeObservedLock(
  file: string,
  observation: LockObservation,
): Promise<boolean> {
  const current = await observeLock(file);
  if (!current) return true;
  if (!sameLock(observation, current)) return false;
  try {
    await rm(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return true;
}

async function removeOwnedLock(
  file: string,
  ownerId: string,
): Promise<void> {
  const observation = await observeLock(file);
  if (observation?.record?.ownerId !== ownerId) return;
  await removeObservedLock(file, observation);
}

async function createOwnedLock(
  file: string,
): Promise<{ handle: FileHandle; ownerId: string }> {
  const ownerId = randomUUID();
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        ownerId,
      } satisfies OwnedLockRecord)}\n`,
      "utf8",
    );
    await handle.sync();
    return { handle, ownerId };
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(file, { force: true }).catch(() => {});
    throw error;
  }
}

async function acquireReclaimGuard(
  file: string,
): Promise<{ handle: FileHandle; ownerId: string } | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await createOwnedLock(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const observation = await observeLock(file);
      if (!observation) continue;
      if (!staleLock(observation)) return null;
      if (!(await removeObservedLock(file, observation))) continue;
    }
  }
  return null;
}

async function reclaimStaleLock(file: string): Promise<boolean> {
  const reclaimFile = `${file}.reclaim`;
  const reclaim = await acquireReclaimGuard(reclaimFile);
  if (!reclaim) return false;
  try {
    const observation = await observeLock(file);
    if (!observation || !staleLock(observation)) return false;
    return removeObservedLock(file, observation);
  } finally {
    await reclaim.handle.close().catch(() => {});
    await removeOwnedLock(reclaimFile, reclaim.ownerId).catch(() => {});
  }
}

export class ConnectorInstanceLock {
  private released = false;

  private constructor(
    private readonly file: string,
    private readonly handle: FileHandle,
    private readonly ownerId: string,
  ) {}

  static async acquire(file: string): Promise<ConnectorInstanceLock> {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const lock = await createOwnedLock(file);
        return new ConnectorInstanceLock(file, lock.handle, lock.ownerId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        if (attempt > 0 || !(await reclaimStaleLock(file))) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error(
              "Another OvertChat Connector is already running for this pairing. Stop the installed service before running a development connector.",
            );
          }
        }
      }
    }
    throw new Error("Unable to acquire the OvertChat Connector instance lock.");
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await this.handle.close();
    await removeOwnedLock(this.file, this.ownerId);
  }
}
