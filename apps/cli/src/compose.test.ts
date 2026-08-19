import { describe, expect, it } from "vitest";
import { renderComposeFile, renderStackEnvironment } from "./compose.js";
import type { InstallationConfig, RuntimePaths } from "./types.js";

const paths: RuntimePaths = {
  configDirectory: "/home/test/.config/overtchat",
  stateFile: "/home/test/.config/overtchat/installation.json",
  secretsFile: "/home/test/.config/overtchat/stack.env",
  stackDirectory: "/home/test/.local/share/overtchat",
  composeFile: "/home/test/.local/share/overtchat/compose.yml",
  searxngDirectory: "/home/test/.local/share/overtchat/searxng",
  searxngSettingsFile:
    "/home/test/.local/share/overtchat/searxng/settings.yml",
};

function config(): InstallationConfig {
  return {
    format: 1,
    appVersion: "1.2.3",
    appImage: "ghcr.io/example/overtchat:1.2.3",
    connectorVersion: "2.0.0",
    sttVersion: "3.0.0",
    appPort: 4718,
    bindAddress: "0.0.0.0",
    publicUrl: "http://192.168.1.10:4718",
    extraTrustedOrigins: ["https://chat.example.com"],
    connectorServerUrl: "http://192.168.1.10:4718",
    composeProject: "overtchat",
    dataMountType: "volume",
    dataVolume: "existing_overtchat-data",
    search: {
      provider: "brave",
      bundledInstalled: false,
      apiKey: "brave-secret",
    },
    tts: {
      provider: "bundled",
      bundledInstalled: true,
      apiKey: "tts-secret",
    },
    stt: {
      provider: "disabled",
      bundledInstalled: true,
      accelerator: "gpu",
      gpuUuid: "GPU-abc",
      apiKey: "stt-secret",
    },
    agents: { installed: true },
  };
}

describe("managed Compose configuration", () => {
  it("starts installed local services independently from the active provider", () => {
    const environment = renderStackEnvironment(
      config(),
      {
        betterAuthSecret: "auth",
        managementSecret: "management",
        searxngSecret: "search",
      },
      paths,
    );

    expect(environment).toContain(
      'COMPOSE_PROFILES="tts-bundled,stt-gpu"',
    );
    expect(environment).toContain(
      'OVERTCHAT_INSTALLED_CAPABILITIES="tts,stt,agents"',
    );
    expect(environment).toContain('WEB_SEARCH_PROVIDER="brave"');
    expect(environment).toContain(
      'EXTRA_TRUSTED_ORIGINS="http://192.168.1.10:4718,http://localhost:4718,http://127.0.0.1:4718,https://chat.example.com"',
    );
    expect(environment).toContain(
      'HOST_CONNECTOR_URL="http://192.168.1.10:4718"',
    );
    expect(environment).toContain('STT_GPU_DEVICE_ID="GPU-abc"');
    expect(environment).toContain(
      'OVERTCHAT_DATA_SOURCE="existing_overtchat-data"',
    );
    expect(environment).not.toContain("BRAVE_SEARCH_API_KEY");
    expect(environment).not.toContain("TTS_API_KEY");
    expect(environment).not.toContain("STT_API_KEY");
    expect(environment).not.toContain("brave-secret");
    expect(environment).not.toContain("tts-secret");
    expect(environment).not.toContain("stt-secret");
  });

  it("keeps optional services behind Compose profiles", () => {
    const compose = renderComposeFile(config());
    expect(compose).toContain("profiles: [search-bundled]");
    expect(compose).toContain("profiles: [tts-bundled]");
    expect(compose).toContain("profiles: [stt-cpu]");
    expect(compose).toContain("profiles: [stt-gpu]");
    expect(compose).toContain('device_ids: ["${STT_GPU_DEVICE_ID}"]');
    expect(compose).toContain("- overtchat-npm-cache:/app/npm-cache");
    expect(compose).toContain("\n  overtchat-npm-cache:\n");
    expect(compose).toContain("external: true");
    expect(compose).not.toContain("BRAVE_SEARCH_API_KEY");
    expect(compose).not.toContain("TTS_API_KEY");
    expect(compose).not.toContain("STT_API_KEY");
  });

  it("preserves an adopted bind-mounted data directory", () => {
    const bindConfig = {
      ...config(),
      dataMountType: "bind" as const,
      dataVolume: "/srv/overtchat/data",
    };
    const compose = renderComposeFile(bindConfig);

    expect(compose).toContain("type: bind");
    expect(compose).toContain("source: ${OVERTCHAT_DATA_SOURCE}");
    expect(compose).toContain("- overtchat-npm-cache:/app/npm-cache");
    expect(compose).not.toContain("external: true");
  });
});
