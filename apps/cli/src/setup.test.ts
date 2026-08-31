import { afterEach, describe, expect, it, vi } from "vitest";
import { installationNeedsAdoption, setup, syncCapabilities } from "./setup.js";
import type { ExistingInstallation } from "./types.js";
import type { InstallationConfig } from "./types.js";

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
    publicUrl: "http://localhost:4718",
    extraTrustedOrigins: [],
    connectorServerUrl: "http://127.0.0.1:4718",
    composeProject: "overtchat",
    dataMountType: "volume",
    dataVolume: "overtchat-data",
    search: {
      provider: "brave",
      bundledInstalled: false,
      apiKey: "replacement-search-key",
    },
    tts: {
      provider: "openai-compatible",
      bundledInstalled: false,
      baseUrl: "https://speech.example.com/v1",
      apiKey: "",
      model: "tts-1",
      voice: "alloy",
    },
    stt: {
      provider: "openai-compatible",
      bundledInstalled: false,
      baseUrl: "https://speech.example.com/v1",
      model: "whisper-1",
    },
    voice: { installed: false },
    agents: { installed: false },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function existingInstallation(
  composeWorkingDir: string | undefined,
): ExistingInstallation {
  return {
    containerName: "overtchat-app",
    appVersion: "0.13.9",
    appImage: "ghcr.io/yoloyash/overtchat-app:0.13.9",
    composeProject: "overtchat",
    composeWorkingDir,
    dataMountType: "volume",
    dataVolume: "overtchat_overtchat-data",
    appPort: 4718,
    bindAddress: "0.0.0.0",
    publicUrl: "http://localhost:4718",
    environment: new Map(),
    bundledServices: { search: true, tts: true, stt: true },
    sttAccelerator: "cpu",
  };
}

describe("installation adoption", () => {
  it("requires a validated manifest before production setup", async () => {
    await expect(
      setup({ dryRun: true, defaults: true, development: false }),
    ).rejects.toThrow("A release manifest is required for production setup.");
  });

  it("adopts stacks outside the managed directory", () => {
    expect(
      installationNeedsAdoption(
        existingInstallation("/home/yash/dev/overtchat"),
        "/home/yash/.local/share/overtchat",
      ),
    ).toBe(true);
  });

  it("does not re-adopt a stack already owned by the manager", () => {
    expect(
      installationNeedsAdoption(
        existingInstallation("/home/yash/.local/share/overtchat"),
        "/home/yash/.local/share/overtchat",
      ),
    ).toBe(false);
  });

  it("fails safe when the prior Compose directory is unknown", () => {
    expect(
      installationNeedsAdoption(
        existingInstallation(undefined),
        "/home/yash/.local/share/overtchat",
      ),
    ).toBe(true);
  });
});

describe("capability synchronization", () => {
  it("replaces explicit keys, clears explicit blanks, and preserves omitted keys", async () => {
    let submitted: unknown;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PUT") {
        submitted = JSON.parse(String(init.body));
        return Response.json({ capabilities: [] });
      }
      return Response.json({
        capabilities: [
          {
            id: "search",
            provider: "brave",
            bundledInstalled: false,
            baseUrl: null,
            apiKey: "stored-search-key",
            model: null,
            voice: null,
          },
          {
            id: "tts",
            provider: "openai-compatible",
            bundledInstalled: false,
            baseUrl: "https://speech.example.com/v1",
            apiKey: "stored-tts-key",
            model: "tts-1",
            voice: "alloy",
          },
          {
            id: "stt",
            provider: "openai-compatible",
            bundledInstalled: false,
            baseUrl: "https://speech.example.com/v1",
            apiKey: "stored-stt-key",
            model: "whisper-1",
            voice: null,
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await syncCapabilities(config(), "management-secret");

    expect(submitted).toMatchObject({
      capabilities: [
        { id: "search", apiKey: "replacement-search-key" },
        { id: "tts", apiKey: null },
        { id: "stt", apiKey: "stored-stt-key" },
      ],
    });
  });
});
