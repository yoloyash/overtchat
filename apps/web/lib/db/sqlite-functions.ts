import type Database from "better-sqlite3";

export function registerSqliteFunctions(sqlite: Database.Database): void {
  // SQLite's built-in lower() only folds ASCII. Normalize equivalent Unicode
  // spellings too, so filenames from different operating systems match.
  sqlite.function("unicode_lower", { deterministic: true }, (value: unknown) =>
    typeof value === "string" ? value.normalize("NFC").toLowerCase().normalize("NFC") : null,
  );
}
