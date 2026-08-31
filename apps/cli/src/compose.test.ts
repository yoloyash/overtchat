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
    voiceVersion: "0.1.0",
    voiceImage: "ghcr.io/example/overtchat-voice:0.1.0",
    connectorVersion: "2.0.0",
    sttVersion: "3.0.0",
    redisImage: `docker.io/library/redis@sha256:${"a".repeat(64)}`,
    searxngImage: `docker.io/searxng/searxng@sha256:${"b".repeat(64)}`,
    kokoroImage: `ghcr.io/remsky/kokoro-fastapi-cpu@sha256:${"c".repeat(64)}`,
    kokoroGpuImage: `ghcr.io/remsky/kokoro-fastapi-gpu@sha256:${"d".repeat(64)}`,
    kokoroGpuBlackwellImage: `ghcr.io/remsky/kokoro-fastapi-gpu@sha256:${"e".repeat(64)}`,
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
    voice: { installed: true },
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
        voiceSharedSecret: "voice-secret",
      },
      paths,
    );

    expect(environment).toContain(
      'COMPOSE_PROFILES="tts-cpu,stt-gpu,voice"',
    );
    expect(environment).toContain(
      'OVERTCHAT_INSTALLED_CAPABILITIES="tts,stt,voice,agents"',
    );
    expect(environment).toContain('WEB_SEARCH_PROVIDER="brave"');
    expect(environment).toContain(
      'EXTRA_TRUSTED_ORIGINS="http://192.168.1.10:4718,http://localhost:4718,http://127.0.0.1:4718,https://chat.example.com"',
    );
    expect(environment).toContain(
      'HOST_CONNECTOR_URL="http://192.168.1.10:4718"',
    );
    expect(environment).toContain('DISABLE_UPDATE_CHECK="false"');
    expect(environment).toContain('STT_GPU_DEVICE_ID="GPU-abc"');
    expect(environment).toContain('TTS_GPU_DEVICE_ID="0"');
    expect(environment).toContain('VOICE_VERSION="0.1.0"');
    expect(environment).toContain(`OVERTCHAT_REDIS_IMAGE="${config().redisImage}"`);
    expect(environment).toContain(`OVERTCHAT_SEARXNG_IMAGE="${config().searxngImage}"`);
    expect(environment).toContain(`OVERTCHAT_KOKORO_IMAGE="${config().kokoroImage}"`);
    expect(environment).toContain(
      `OVERTCHAT_KOKORO_GPU_IMAGE="${config().kokoroGpuImage}"`,
    );
    expect(environment).toContain(`OVERTCHAT_VOICE_IMAGE="${config().voiceImage}"`);
    expect(environment).toContain('VOICE_SHARED_SECRET="voice-secret"');
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
    expect(compose).toContain("profiles: [tts-cpu]");
    expect(compose).toContain("profiles: [tts-gpu]");
    expect(compose).toContain("profiles: [stt-cpu]");
    expect(compose).toContain("profiles: [stt-gpu]");
    expect(compose).toContain("profiles: [voice]");
    expect(compose).toContain("image: ${OVERTCHAT_REDIS_IMAGE}");
    expect(compose).toContain("image: ${OVERTCHAT_SEARXNG_IMAGE}");
    expect(compose).toContain("image: ${OVERTCHAT_KOKORO_IMAGE}");
    expect(compose).toContain("image: ${OVERTCHAT_KOKORO_GPU_IMAGE}");
    expect(compose).toContain("image: ${OVERTCHAT_VOICE_IMAGE}");
    expect(compose).toContain("VOICE_SHARED_SECRET: ${VOICE_SHARED_SECRET}");
    expect(compose).not.toContain("8765:8765");
    expect(compose).toContain('device_ids: ["${STT_GPU_DEVICE_ID}"]');
    expect(compose).toContain('device_ids: ["${TTS_GPU_DEVICE_ID}"]');
    expect(compose).toContain(
      "DISABLE_UPDATE_CHECK: ${DISABLE_UPDATE_CHECK:-false}",
    );
    expect(compose).toContain("- overtchat-npm-cache:/app/npm-cache");
    expect(compose).toContain("\n  overtchat-npm-cache:\n");
    expect(compose).toContain("external: true");
    expect(compose).not.toContain("BRAVE_SEARCH_API_KEY");
    expect(compose).not.toContain("TTS_API_KEY");
    expect(compose).not.toContain("STT_API_KEY");
  });

  it("selects the Blackwell image and GPU profile independently from STT", () => {
    const gpuConfig = config();
    gpuConfig.tts = {
      provider: "bundled",
      bundledInstalled: true,
      accelerator: "gpu",
      gpuUuid: "GPU-5090",
      gpuVariant: "blackwell",
    };
    gpuConfig.stt = {
      provider: "bundled",
      bundledInstalled: true,
      accelerator: "cpu",
    };

    const environment = renderStackEnvironment(
      gpuConfig,
      {
        betterAuthSecret: "auth",
        managementSecret: "management",
        searxngSecret: "search",
        voiceSharedSecret: "voice",
      },
      paths,
    );

    expect(environment).toContain('COMPOSE_PROFILES="tts-gpu,stt-cpu,voice"');
    expect(environment).toContain('TTS_GPU_DEVICE_ID="GPU-5090"');
    expect(environment).toContain('TTS_GPU_VARIANT="blackwell"');
    expect(environment).toContain(
      `OVERTCHAT_KOKORO_GPU_IMAGE="${gpuConfig.kokoroGpuBlackwellImage}"`,
    );
  });

  it("does not enable bundled profiles for external speech providers", () => {
    const externalConfig = config();
    externalConfig.search = { provider: "brave", bundledInstalled: false };
    externalConfig.tts = {
      provider: "openai-compatible",
      bundledInstalled: false,
      baseUrl: "http://tts.example.com",
    };
    externalConfig.stt = {
      provider: "openai-compatible",
      bundledInstalled: false,
      baseUrl: "http://stt.example.com",
    };

    const environment = renderStackEnvironment(
      externalConfig,
      {
        betterAuthSecret: "auth",
        managementSecret: "management",
        searxngSecret: "search",
        voiceSharedSecret: "voice",
      },
      paths,
    );

    expect(environment).toContain('COMPOSE_PROFILES="voice"');
    expect(environment).not.toContain("stt-gpu");
    expect(environment).not.toContain("stt-cpu");
    expect(environment).not.toContain("tts-gpu");
    expect(environment).not.toContain("tts-cpu");
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
