import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  existingInstallationSummary,
  kokoroGpuVariant,
  promptInstallationConfig,
} from "./prompts.js";
import type { ExistingInstallation, InstallationConfig } from "./types.js";

const promptAnswers = vi.hoisted(() => new Map<string, unknown>());
const selectPrompts = vi.hoisted(
  () =>
    [] as Array<{
      message: string;
      options: Array<{ value: string; label: string }>;
    }>,
);
const confirmPrompts = vi.hoisted(
  () =>
    [] as Array<{
      message: string;
      active: string;
      inactive: string;
    }>,
);

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: vi.fn(
    async (prompt: { message: string; active: string; inactive: string }) => {
      confirmPrompts.push(prompt);
      return promptAnswers.get(prompt.message);
    },
  ),
  intro: vi.fn(),
  isCancel: vi.fn(() => false),
  note: vi.fn(),
  password: vi.fn(async ({ message }: { message: string }) =>
    promptAnswers.get(message),
  ),
  select: vi.fn(
    async (prompt: {
      message: string;
      options: Array<{ value: string; label: string }>;
    }) => {
      selectPrompts.push(prompt);
      return promptAnswers.get(prompt.message);
    },
  ),
  text: vi.fn(async ({ message }: { message: string }) =>
    promptAnswers.get(message),
  ),
}));

vi.mock("./process.js", () => ({
  commandExists: vi.fn(async () => false),
}));

beforeEach(() => {
  promptAnswers.clear();
  selectPrompts.length = 0;
  confirmPrompts.length = 0;
});

function installation(
  overrides: Partial<ExistingInstallation> = {},
): ExistingInstallation {
  return {
    containerName: "overtchat-app",
    appVersion: "0.13.9",
    appImage: "ghcr.io/yoloyash/overtchat-app:0.13.9",
    composeProject: "overtchat",
    composeWorkingDir: "/home/yash/dev/overtchat",
    dataMountType: "volume",
    dataVolume: "overtchat_overtchat-data",
    appPort: 49317,
    bindAddress: "127.0.0.1",
    publicUrl: "https://chat.example.com",
    environment: new Map(),
    bundledServices: { search: true, tts: true, stt: true },
    sttAccelerator: "cpu",
    ...overrides,
  };
}

function setupConfig(): InstallationConfig {
  return {
    format: 1,
    appVersion: "1.2.3",
    appImage: "ghcr.io/example/overtchat:1.2.3",
    voiceVersion: "1.0.0",
    voiceImage: "ghcr.io/example/overtchat-voice:1.0.0",
    connectorVersion: "2.0.0",
    sttVersion: "3.0.0",
    redisImage: "redis",
    searxngImage: "searxng",
    kokoroImage: "kokoro-cpu",
    kokoroGpuImage: "kokoro-gpu",
    kokoroGpuBlackwellImage: "kokoro-gpu-blackwell",
    appPort: 4717,
    bindAddress: "0.0.0.0",
    publicUrl: "http://localhost:4717",
    extraTrustedOrigins: [],
    connectorServerUrl: "http://127.0.0.1:4717",
    composeProject: "overtchat",
    dataMountType: "volume",
    dataVolume: "overtchat-data",
    search: { provider: "bundled", bundledInstalled: true },
    tts: {
      provider: "bundled",
      bundledInstalled: true,
      accelerator: "gpu",
      gpuUuid: "GPU-old",
      gpuVariant: "standard",
    },
    stt: {
      provider: "bundled",
      bundledInstalled: true,
      accelerator: "gpu",
      gpuUuid: "GPU-old",
    },
    voice: { installed: true },
    agents: { installed: true },
  };
}

describe("existing installation summary", () => {
  it("makes the reused production resources and safety behavior explicit", () => {
    expect(existingInstallationSummary(installation())).toBe(
      [
        "Version: 0.13.9",
        "Address: https://chat.example.com",
        "Published port: 127.0.0.1:49317",
        "Data: Docker volume overtchat_overtchat-data",
        "Compose directory: /home/yash/dev/overtchat",
        "Bundled services: SearXNG, Kokoro (CPU), Parakeet (CPU)",
        "",
        "This storage will be reused. A verified SQLite snapshot will be created before the app is replaced or migrations run.",
      ].join("\n"),
    );
  });

  it("describes bind mounts and unavailable metadata honestly", () => {
    const summary = existingInstallationSummary(
      installation({
        appVersion: undefined,
        composeWorkingDir: undefined,
        dataMountType: "bind",
        dataVolume: "/srv/overtchat/data",
        bundledServices: { search: false, tts: false, stt: false },
      }),
    );

    expect(summary).toContain("Version: unknown");
    expect(summary).toContain("Data: Bind mount /srv/overtchat/data");
    expect(summary).toContain("Bundled services: none detected");
  });

  it("selects the Blackwell image only for x64 compute capability 12 GPUs", () => {
    const gpu = {
      index: 0,
      uuid: "GPU-5090",
      name: "NVIDIA GeForce RTX 5090",
      memoryMiB: 32_000,
      computeCapability: 12,
    };

    expect(kokoroGpuVariant(gpu, "x64")).toBe("blackwell");
    expect(kokoroGpuVariant(gpu, "arm64")).toBe("standard");
    expect(
      kokoroGpuVariant({ ...gpu, name: "RTX 4090", computeCapability: 8.9 }, "x64"),
    ).toBe("standard");
  });
});

describe("setup provider selection", () => {
  it("removes hidden bundled speech services after external providers are selected", async () => {
    const config = setupConfig();
    promptAnswers.set("Web search", "brave");
    promptAnswers.set("Brave Search API key", "brave-key");
    promptAnswers.set("Text-to-speech", "openai-compatible");
    promptAnswers.set("TTS API base URL", "http://tts.example.com");
    promptAnswers.set("TTS API key (leave blank when not required)", "");
    promptAnswers.set("TTS model", "kokoro");
    promptAnswers.set("Default voice", "af_heart");
    promptAnswers.set("Speech-to-text", "openai-compatible");
    promptAnswers.set("STT API base URL", "http://stt.example.com");
    promptAnswers.set("STT API key (leave blank when not required)", "");
    promptAnswers.set("STT model", "parakeet");
    promptAnswers.set("Install realtime voice conversations?", true);
    promptAnswers.set("Install Agent Connections?", false);

    const selected = await promptInstallationConfig(config, []);

    expect(selected.search).toMatchObject({
      provider: "brave",
      bundledInstalled: false,
    });
    expect(selected.tts).toMatchObject({
      provider: "openai-compatible",
      bundledInstalled: false,
    });
    expect(selected.tts).not.toHaveProperty("accelerator");
    expect(selected.tts).not.toHaveProperty("gpuUuid");
    expect(selected.stt).toMatchObject({
      provider: "openai-compatible",
      bundledInstalled: false,
    });
    expect(selected.stt).not.toHaveProperty("accelerator");
    expect(selected.stt).not.toHaveProperty("gpuUuid");
    for (const message of ["Web search", "Text-to-speech", "Speech-to-text"]) {
      expect(
        selectPrompts.find((prompt) => prompt.message === message)?.options,
      ).toContainEqual({
        value: "disabled",
        label: "Set up later",
        hint: expect.any(String),
      });
    }
    for (const message of [
      "Install realtime voice conversations?",
      "Install Agent Connections?",
    ]) {
      expect(
        confirmPrompts.find((prompt) => prompt.message === message),
      ).toMatchObject({
        active: "Yes",
        inactive: "Set up later",
      });
    }
  });

  it("removes previously installed optional services when setup is deferred", async () => {
    promptAnswers.set("Web search", "disabled");
    promptAnswers.set("Text-to-speech", "disabled");
    promptAnswers.set("Speech-to-text", "disabled");
    promptAnswers.set("Install Agent Connections?", false);

    const selected = await promptInstallationConfig(setupConfig(), []);

    expect(selected.search).toEqual({
      provider: "disabled",
      bundledInstalled: false,
    });
    expect(selected.tts).toEqual({
      provider: "disabled",
      bundledInstalled: false,
    });
    expect(selected.stt).toEqual({
      provider: "disabled",
      bundledInstalled: false,
    });
    expect(selected.voice).toEqual({ installed: false });
  });
});
