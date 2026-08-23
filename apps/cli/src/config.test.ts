import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultInstallationConfig,
  initialSecrets,
  readInstallationConfig,
  writeInstallationConfig,
} from "./config.js";
import type { ReleaseManifest } from "./release.js";
import type { ExistingInstallation, RuntimePaths } from "./types.js";

const manifest: ReleaseManifest = {
  format: 1,
  cliVersion: "1.0.0",
  appVersion: "2.0.0",
  connectorVersion: "3.0.0",
  sttVersion: "4.0.0",
  redisImage: `docker.io/library/redis@sha256:${"a".repeat(64)}`,
  searxngImage: `docker.io/searxng/searxng@sha256:${"b".repeat(64)}`,
  kokoroImage: `ghcr.io/remsky/kokoro-fastapi-cpu@sha256:${"c".repeat(64)}`,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function existing(
  overrides: Partial<ExistingInstallation> = {},
): ExistingInstallation {
  return {
    containerName: "overtchat-app",
    composeProject: "homechat",
    composeWorkingDir: "/srv/overtchat",
    dataMountType: "bind",
    dataVolume: "/srv/overtchat/data",
    appPort: 9000,
    bindAddress: "127.0.0.1",
    publicUrl: "https://chat.example.com",
    bundledServices: { search: false, tts: false, stt: false },
    environment: new Map([
      ["BETTER_AUTH_SECRET", "existing-auth-secret"],
      ["EXTRA_TRUSTED_ORIGINS", "https://mobile.example.com"],
      ["HOST_CONNECTOR_URL", "https://chat.example.com"],
      ["SEARXNG_URL", "http://search.internal:8080"],
      ["KOKORO_URL", "http://speech.internal:8880"],
    ]),
    ...overrides,
  };
}

describe("existing installation adoption", () => {
  it("uses the release manifest for a fresh installation", () => {
    expect(defaultInstallationConfig(null, manifest)).toMatchObject({
      appVersion: "2.0.0",
      appImage: "ghcr.io/yoloyash/overtchat-app:2.0.0",
      connectorVersion: "3.0.0",
      sttVersion: "4.0.0",
      redisImage: manifest.redisImage,
      searxngImage: manifest.searxngImage,
      kokoroImage: manifest.kokoroImage,
    });
  });

  it("preserves network, storage, secrets, and external providers", () => {
    const detected = existing();
    const config = defaultInstallationConfig(detected, manifest);

    expect(config).toMatchObject({
      composeProject: "homechat",
      adoptedFrom: "/srv/overtchat",
      dataMountType: "bind",
      dataVolume: "/srv/overtchat/data",
      appPort: 9000,
      bindAddress: "127.0.0.1",
      publicUrl: "https://chat.example.com",
      extraTrustedOrigins: ["https://mobile.example.com"],
      connectorServerUrl: "https://chat.example.com",
      search: {
        provider: "searxng",
        baseUrl: "http://search.internal:8080",
      },
      tts: {
        provider: "openai-compatible",
        baseUrl: "http://speech.internal:8880",
      },
    });
    expect(initialSecrets(detected).betterAuthSecret).toBe(
      "existing-auth-secret",
    );
  });

  it("never downgrades an already newer official app image", () => {
    const config = defaultInstallationConfig(
      existing({
        appVersion: "9.1.0",
        appImage: "ghcr.io/yoloyash/overtchat-app:9.1.0",
      }),
      manifest,
    );

    expect(config.appVersion).toBe("9.1.0");
    expect(config.appImage).toBe("ghcr.io/yoloyash/overtchat-app:9.1.0");
  });

  it("preserves an explicit update-check opt-out", () => {
    vi.stubEnv("DISABLE_UPDATE_CHECK", "true");

    expect(
      defaultInstallationConfig(existing(), manifest).disableUpdateCheck,
    ).toBe(true);
  });
});

describe("managed installation state", () => {
  it("never persists provider API keys", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "overtchat-installation-state-"),
    );
    const paths: RuntimePaths = {
      configDirectory: directory,
      stateFile: path.join(directory, "installation.json"),
      secretsFile: path.join(directory, "stack.env"),
      stackDirectory: path.join(directory, "stack"),
      composeFile: path.join(directory, "stack", "compose.yml"),
      searxngDirectory: path.join(directory, "stack", "searxng"),
      searxngSettingsFile: path.join(
        directory,
        "stack",
        "searxng",
        "settings.yml",
      ),
    };
    try {
      const config = defaultInstallationConfig(null, manifest);
      config.search.apiKey = "brave-secret";
      config.tts.apiKey = "tts-secret";
      config.stt.apiKey = "stt-secret";

      await writeInstallationConfig(paths, config);

      const contents = await readFile(paths.stateFile, "utf8");
      expect(contents).not.toContain("brave-secret");
      expect(contents).not.toContain("tts-secret");
      expect(contents).not.toContain("stt-secret");
      expect(contents).not.toContain("apiKey");
      vi.stubEnv("DISABLE_UPDATE_CHECK", "true");
      const loaded = await readInstallationConfig(paths);
      expect(loaded?.search.apiKey).toBeUndefined();
      expect(loaded?.tts.apiKey).toBeUndefined();
      expect(loaded?.stt.apiKey).toBeUndefined();
      expect(loaded?.disableUpdateCheck).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
