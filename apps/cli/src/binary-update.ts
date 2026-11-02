import { randomUUID } from "node:crypto";
import { chmod, copyFile, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, renameWithRetry, syncDirectory } from "./atomic-file.js";

type Record = { format: 1; previous: boolean; committed: boolean };

async function exists(file: string): Promise<boolean> {
  try { await stat(file); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

// Caller holds the executable's update lock until recovery/commit completes.
// The journal precedes every destructive operation. A prepared transaction is
// rolled back on the next attempt; a committed one only needs backup cleanup.
export class BinaryUpdate {
  readonly backup: string;
  readonly staged: string;
  readonly journal: string;
  private record?: Record;

  constructor(readonly target: string) {
    this.backup = `${target}.previous`;
    this.staged = `${target}.next`;
    this.journal = `${target}.update.json`;
  }

  async pending(): Promise<boolean> {
    let raw: string;
    try { raw = await readFile(this.journal, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    const record = JSON.parse(raw) as Record;
    if (record.format !== 1 || typeof record.previous !== "boolean" || typeof record.committed !== "boolean")
      throw new Error(`Invalid update recovery record: ${this.journal}. Preserve the backup at ${this.backup}.`);
    this.record = record;
    return true;
  }

  get committed(): boolean { return this.record?.committed === true; }
  get hadPrevious(): boolean { return this.record?.previous === true; }

  async prepare(source: string): Promise<void> {
    if (await this.pending()) throw new Error(`An interrupted update needs recovery: ${this.journal}`);
    // Never discard an unjournaled backup left by an older manager.
    if (await exists(this.backup)) throw new Error(`A previous update backup exists at ${this.backup}. Recover it before updating.`);
    await copyFile(source, this.staged);
    await chmod(this.staged, 0o755);
    const handle = await open(this.staged, "r+");
    try { await handle.sync(); } finally { await handle.close(); }
    this.record = { format: 1, previous: await exists(this.target), committed: false };
    await atomicWrite(this.journal, JSON.stringify(this.record));
  }

  async replace(): Promise<void> {
    if (!this.record) throw new Error("Update was not prepared.");
    if (this.hadPrevious) {
      if (process.platform === "win32") await renameWithRetry(this.target, this.backup);
      else {
        const stagedBackup = `${this.backup}.next`;
        await copyFile(this.target, stagedBackup);
        const handle = await open(stagedBackup, "r+");
        try { await handle.sync(); } finally { await handle.close(); }
        await renameWithRetry(stagedBackup, this.backup);
      }
      await syncDirectory(path.dirname(this.target));
    }
    await renameWithRetry(this.staged, this.target);
    await syncDirectory(path.dirname(this.target));
  }

  async restore(): Promise<void> {
    if (!this.record || this.committed) return;
    if (await exists(this.backup)) {
      if (process.platform === "win32" && await exists(this.target)) {
        // Also works when recovery is running from the replacement CLI image.
        const abandoned = `${this.target}.abandoned-${randomUUID()}`;
        await renameWithRetry(this.target, abandoned);
        await rm(abandoned, { force: true }).catch(() => {});
      }
      await renameWithRetry(this.backup, this.target);
    } else if (!this.hadPrevious) await rm(this.target, { force: true });
    else if (!await exists(this.target)) throw new Error(`Neither the installed executable nor its backup exists: ${this.target}`);
    await syncDirectory(path.dirname(this.target));
    // Keep the journal until service restart and authenticated readiness pass.
  }

  async commit(): Promise<void> {
    if (!this.record) throw new Error("Update was not prepared.");
    this.record.committed = true;
    await atomicWrite(this.journal, JSON.stringify(this.record));
    await this.finish();
  }

  async finish(): Promise<void> {
    // An executing Windows CLI backup stays locked until its parent exits.
    // Bun on Windows reports EFAULT for this mapped-image deletion as well.
    try { await rm(this.backup, { force: true }); }
    catch (error) {
      if (this.committed && process.platform === "win32" && ["EPERM", "EBUSY", "EACCES", "EFAULT"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      throw error;
    }
    await rm(this.staged, { force: true });
    await rm(`${this.backup}.next`, { force: true });
    await rm(this.journal, { force: true });
    await syncDirectory(path.dirname(this.target));
    this.record = undefined;
  }
}
