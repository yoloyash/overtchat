import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";

const WINDOWS_RENAME_RETRIES = 20;
const WINDOWS_RENAME_DELAY_MS = 100;

export async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

// Antivirus scanners and the search indexer briefly hold newly written files
// open on Windows, which makes replacing them fail with a sharing violation.
export async function renameWithRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await rename(source, destination); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (process.platform !== "win32" || !["EBUSY", "EPERM", "EACCES"].includes(code) || attempt >= WINDOWS_RENAME_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, WINDOWS_RENAME_DELAY_MS));
    }
  }
}

export async function atomicWrite(file: string, contents: string, mode = 0o600): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", mode);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    await renameWithRetry(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally { await rm(temporary, { force: true }); }
}
