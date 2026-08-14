import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultInstallationConfig,
  initialSecrets,
  readInstallationConfig,
  writeInstallationConfig,
} from "./config.js";
import type { ExistingInstallation, RuntimePaths } from "./types.js";

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
  it("preserves network, storage, secrets, and external providers", () => {
    const detected = existing();
    const config = defaultInstallationConfig(detected);

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
    );

    expect(config.appVersion).toBe("9.1.0");
    expect(config.appImage).toBe("ghcr.io/yoloyash/overtchat-app:9.1.0");
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
      const config = defaultInstallationConfig(null);
      config.search.apiKey = "brave-secret";
      config.tts.apiKey = "tts-secret";
      config.stt.apiKey = "stt-secret";

      await writeInstallationConfig(paths, config);

      const contents = await readFile(paths.stateFile, "utf8");
      expect(contents).not.toContain("brave-secret");
      expect(contents).not.toContain("tts-secret");
      expect(contents).not.toContain("stt-secret");
      expect(contents).not.toContain("apiKey");
      const loaded = await readInstallationConfig(paths);
      expect(loaded?.search.apiKey).toBeUndefined();
      expect(loaded?.tts.apiKey).toBeUndefined();
      expect(loaded?.stt.apiKey).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
