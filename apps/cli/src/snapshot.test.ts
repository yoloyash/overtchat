import { describe, expect, it } from "vitest";
import { databaseSnapshot, snapshotDockerArgs } from "./snapshot.js";
import type { ExistingInstallation, InstallationConfig } from "./types.js";

function existing(
  overrides: Partial<ExistingInstallation> = {},
): ExistingInstallation {
  return {
    containerName: "overtchat-app",
    appVersion: "0.13.9",
    appImage: "ghcr.io/yoloyash/overtchat-app:0.13.9",
    composeProject: "overtchat",
    composeWorkingDir: "/srv/overtchat",
    dataMountType: "volume",
    dataVolume: "overtchat_overtchat-data",
    appPort: 4718,
    bindAddress: "127.0.0.1",
    publicUrl: "https://chat.example.com",
    environment: new Map(),
    bundledServices: { search: true, tts: true, stt: true },
    sttAccelerator: "cpu",
    ...overrides,
  };
}

function config(): InstallationConfig {
  return {
    format: 1,
    appVersion: "0.14.0",
    appImage: "ghcr.io/yoloyash/overtchat-app:0.14.0",
    voiceImage: "ghcr.io/yoloyash/overtchat-voice:0.14.0",
    connectorVersion: "0.5.0",
    sttVersion: "0.1.0",
    redisImage: `docker.io/library/redis@sha256:${"a".repeat(64)}`,
    searxngImage: `docker.io/searxng/searxng@sha256:${"b".repeat(64)}`,
    kokoroImage: `ghcr.io/remsky/kokoro-fastapi-cpu@sha256:${"c".repeat(64)}`,
    appPort: 4718,
    bindAddress: "127.0.0.1",
    publicUrl: "https://chat.example.com",
    extraTrustedOrigins: [],
    connectorServerUrl: "http://127.0.0.1:4718",
    composeProject: "overtchat",
    dataMountType: "volume",
    dataVolume: "overtchat_overtchat-data",
    search: { provider: "bundled", bundledInstalled: true },
    tts: { provider: "bundled", bundledInstalled: true },
    stt: {
      provider: "bundled",
      bundledInstalled: true,
      accelerator: "cpu",
    },
    voice: { installed: false },
    agents: { installed: false },
  };
}

describe("pre-migration snapshots", () => {
  it("creates a stable volume path and a locked-down helper container", () => {
    const installation = existing();
    const snapshot = databaseSnapshot(
      installation,
      new Date("2026-08-14T05:30:12.345Z"),
    );
    const args = snapshotDockerArgs(installation, config(), snapshot);

    expect(snapshot).toEqual({
      fileName: "pre-managed-2026-08-14T05-30-12-345Z.db",
      containerPath:
        "/app/data/backups/pre-managed-2026-08-14T05-30-12-345Z.db",
      displayPath:
        "overtchat_overtchat-data:/backups/pre-managed-2026-08-14T05-30-12-345Z.db",
    });
    expect(args).toContain(
      "type=volume,source=overtchat_overtchat-data,target=/app/data",
    );
    expect(args).toContain("none");
    expect(args).toContain("--read-only");
    expect(args).toContain("no-new-privileges:true");
    expect(args).toContain("ghcr.io/yoloyash/overtchat-app:0.14.0");
    expect(args.at(-1)).toContain("sourceDatabase.backup(destination)");
    expect(args.at(-1)).toContain('snapshot.pragma("journal_mode = DELETE"');
    expect(args.at(-1)).toContain('snapshot.pragma("integrity_check")');
  });

  it("shows the host path for bind-mounted installations", () => {
    const installation = existing({
      dataMountType: "bind",
      dataVolume: "/srv/overtchat/data",
    });
    const snapshot = databaseSnapshot(
      installation,
      new Date("2026-08-14T05:30:12.345Z"),
    );

    expect(snapshot.displayPath).toBe(
      "/srv/overtchat/data/backups/pre-managed-2026-08-14T05-30-12-345Z.db",
    );
    expect(snapshotDockerArgs(installation, config(), snapshot)).toContain(
      "type=bind,source=/srv/overtchat/data,target=/app/data",
    );
  });
});
