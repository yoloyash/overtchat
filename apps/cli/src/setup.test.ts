import { afterEach, describe, expect, it, vi } from "vitest";
import { syncCapabilities } from "./setup.js";
import type { InstallationConfig } from "./types.js";

function config(): InstallationConfig {
  return {
    format: 1,
    appVersion: "1.2.3",
    appImage: "ghcr.io/example/overtchat:1.2.3",
    connectorVersion: "2.0.0",
    sttVersion: "3.0.0",
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
    agents: { installed: false },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
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
