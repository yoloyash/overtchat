import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listCapabilities: vi.fn(),
  getVoiceCapability: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/serverCapabilities", () => ({
  listServerCapabilities: mocks.listCapabilities,
}));
vi.mock("@/lib/voice/capability", () => ({
  getVoiceCapability: mocks.getVoiceCapability,
}));

import { GET } from "./route";

const request = new Request("http://server.test/api/capabilities");

function configuredCapabilities(
  sttProvider = "bundled",
  ttsProvider = "bundled",
) {
  return [
    {
      id: "search",
      provider: "bundled",
      bundledInstalled: true,
    },
    { id: "tts", provider: ttsProvider, bundledInstalled: true },
    { id: "stt", provider: sttProvider, bundledInstalled: true },
  ];
}

describe("public capabilities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.listCapabilities.mockReturnValue(configuredCapabilities());
    mocks.getVoiceCapability.mockReturnValue({
      available: true,
      installed: true,
      unavailableReason: null,
      protocol: "openai-realtime",
      transport: "websocket",
      endpoint: "/api/voice/realtime",
      inputAudio: { encoding: "pcm16", sampleRate: 24_000, channels: 1 },
      outputAudio: { encoding: "pcm16", sampleRate: 24_000, channels: 1 },
    });
  });

  it("requires a signed-in user", async () => {
    mocks.getSession.mockResolvedValue(null);

    expect((await GET(request)).status).toBe(401);
  });

  it("advertises the same-origin realtime endpoint when voice is ready", async () => {
    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      capabilities: {
        voice: {
          available: true,
          installed: true,
          unavailableReason: null,
          protocol: "openai-realtime",
          transport: "websocket",
          endpoint: "/api/voice/realtime",
          inputAudio: {
            encoding: "pcm16",
            sampleRate: 24_000,
            channels: 1,
          },
          outputAudio: {
            encoding: "pcm16",
            sampleRate: 24_000,
            channels: 1,
          },
        },
      },
    });
  });

  it("does not expose an endpoint before the optional service is installed", async () => {
    mocks.getVoiceCapability.mockReturnValue({
      ...mocks.getVoiceCapability(),
      available: false,
      installed: false,
      unavailableReason: "not-installed",
      endpoint: null,
    });

    const response = await GET(request);

    await expect(response.json()).resolves.toMatchObject({
      capabilities: {
        voice: {
          available: false,
          installed: false,
          unavailableReason: "not-installed",
          endpoint: null,
        },
      },
    });
  });

});
