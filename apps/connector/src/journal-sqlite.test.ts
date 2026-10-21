import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncJournalDirectory, syncJournalFile } from "./journal-sqlite.js";

afterEach(() => vi.restoreAllMocks());

it("flushes regular journal files on Windows without swallowing file errors", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const directory = await mkdtemp(path.join(os.tmpdir(), "journal-flush-"));
  try {
    const file = path.join(directory, "journal");
    await writeFile(file, "durable journal");
    await syncJournalFile(file);
    expect(await readFile(file, "utf8")).toBe("durable journal");
    await expect(syncJournalFile(path.join(directory, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
    await syncJournalDirectory(directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
