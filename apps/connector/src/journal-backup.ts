import { chmod, copyFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { ConnectorInstanceLock } from "./lock.js";
import { journalFileKind } from "./state-import.js";
import { openJournalDatabase, syncJournalFile } from "./journal-sqlite.js";

// The pairing service must be stopped. This lock also excludes direct journal
// writers. VACUUM INTO includes committed WAL rows in a standalone snapshot.
export async function backupConnectorJournal(file: string, destination: string): Promise<void> {
  if (file === destination) throw new Error("Journal backup requires a different destination.");
  const lock = await ConnectorInstanceLock.acquire(`${file}.lock`);
  try {
    const kind = await journalFileKind(file);
    if (kind === "missing") throw new Error("Host Connector state journal does not exist.");
    if (kind === "json") await copyFile(file, destination, constants.COPYFILE_EXCL);
    else {
      const source = await openJournalDatabase(file);
      try { source.prepare("VACUUM INTO ?").run(destination); } finally { source.close(); }
      const snapshot = await openJournalDatabase(destination);
      try {
        snapshot.exec("PRAGMA journal_mode = DELETE");
        const rows = snapshot.prepare("PRAGMA integrity_check").all();
        if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") throw new Error("Host Connector journal backup failed integrity_check.");
      } finally { snapshot.close(); }
    }
    await chmod(destination, 0o600);
    await syncJournalFile(destination);
  } finally {
    await lock.release();
  }
  await rm(`${destination}-wal`, { force: true });
  await rm(`${destination}-shm`, { force: true });
}
