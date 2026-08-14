import path from "node:path";
import { requireDocker, type DockerCommand } from "./docker.js";
import type { ExistingInstallation, InstallationConfig } from "./types.js";

const SNAPSHOT_SCRIPT = String.raw`
const fs = require("node:fs");
const Database = require("better-sqlite3");

(async () => {
  const source = "/app/data/chat.db";
  const destination = process.env.OVERTCHAT_SNAPSHOT_PATH;
  if (!destination) throw new Error("Snapshot destination was not provided.");
  const snapshotDirectory = require("node:path").dirname(destination);
  fs.mkdirSync(snapshotDirectory, {
    recursive: true,
    mode: 0o700,
  });
  fs.chmodSync(snapshotDirectory, 0o700);
  try {
    const sourceDatabase = new Database(source, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      await sourceDatabase.backup(destination);
    } finally {
      sourceDatabase.close();
    }
    const snapshot = new Database(destination, {
      fileMustExist: true,
    });
    try {
      const journalMode = snapshot.pragma("journal_mode = DELETE", {
        simple: true,
      });
      if (journalMode !== "delete") {
        throw new Error("Snapshot could not be made self-contained.");
      }
      const integrity = snapshot.pragma("integrity_check");
      if (
        !Array.isArray(integrity) ||
        integrity.length !== 1 ||
        integrity[0]?.integrity_check !== "ok"
      ) {
        throw new Error("Snapshot failed SQLite integrity_check.");
      }
    } finally {
      snapshot.close();
    }
    fs.rmSync(destination + "-wal", { force: true });
    fs.rmSync(destination + "-shm", { force: true });
    fs.chmodSync(destination, 0o600);
  } catch (error) {
    fs.rmSync(destination, { force: true });
    fs.rmSync(destination + "-wal", { force: true });
    fs.rmSync(destination + "-shm", { force: true });
    throw error;
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
`;

export type DatabaseSnapshot = {
  fileName: string;
  containerPath: string;
  displayPath: string;
};

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/gu, "-");
}

export function databaseSnapshot(
  existing: ExistingInstallation,
  date = new Date(),
): DatabaseSnapshot {
  const fileName = `pre-managed-${timestamp(date)}.db`;
  const containerPath = `/app/data/backups/${fileName}`;
  return {
    fileName,
    containerPath,
    displayPath:
      existing.dataMountType === "bind"
        ? path.join(existing.dataVolume, "backups", fileName)
        : `${existing.dataVolume}:/backups/${fileName}`,
  };
}

export function snapshotDockerArgs(
  existing: ExistingInstallation,
  config: InstallationConfig,
  snapshot: DatabaseSnapshot,
): string[] {
  const mount = [
    `type=${existing.dataMountType}`,
    `source=${existing.dataVolume}`,
    "target=/app/data",
  ].join(",");
  return [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--mount",
    mount,
    "--env",
    `OVERTCHAT_SNAPSHOT_PATH=${snapshot.containerPath}`,
    "--entrypoint",
    "node",
    config.appImage,
    "-e",
    SNAPSHOT_SCRIPT,
  ];
}

export async function createPreMigrationSnapshot(
  docker: DockerCommand,
  existing: ExistingInstallation,
  config: InstallationConfig,
  date = new Date(),
): Promise<DatabaseSnapshot> {
  const snapshot = databaseSnapshot(existing, date);
  await requireDocker(
    docker,
    snapshotDockerArgs(existing, config, snapshot),
  );
  return snapshot;
}
