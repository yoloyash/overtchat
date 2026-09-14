import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listCapabilities: vi.fn(),
  imageModel: vi.fn(),
  getVoiceCapability: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/serverCapabilities", () => ({
  listServerCapabilities: mocks.listCapabilities,
}));
vi.mock("@/lib/db/modelConfigs", () => ({ getImageModelConfig: mocks.imageModel }));
vi.mock("@/lib/voice/capability", () => ({
  getVoiceCapability: mocks.getVoiceCapability,
}));

import { GET } from "./route";

const request = new Request("http://server.test/api/capabilities");

const configuredCapabilities = [
  { id: "search", provider: "bundled", bundledInstalled: true },
  { id: "tts", provider: "bundled", bundledInstalled: true },
  { id: "stt", provider: "bundled", bundledInstalled: true },
];

describe("public capabilities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.listCapabilities.mockReturnValue(configuredCapabilities);
    mocks.getVoiceCapability.mockReturnValue({
      available: true,
      installed: true,
      unavailableReason: null,
    });
  });

  it("requires a signed-in user", async () => {
    mocks.getSession.mockResolvedValue(null);

    expect((await GET(request)).status).toBe(401);
  });

  it("exposes only image availability and model, never connection details", async () => {
    mocks.imageModel.mockReturnValue({ providerId: "openai", baseUrl: "https://private.example/v1", apiKey: "private-key", model: "image-model" });
    const body = await (await GET(request)).json();
    expect(body.capabilities.images).toEqual({ available: true, model: "image-model", supportsQuality: true });
    expect(JSON.stringify(body)).not.toContain("private");
  });

  it("advertises realtime voice when it is ready", async () => {
    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      capabilities: {
        voice: {
          available: true,
          installed: true,
          unavailableReason: null,
        },
      },
    });
  });

  it("reports when the optional service is not installed", async () => {
    mocks.getVoiceCapability.mockReturnValue({
      available: false,
      installed: false,
      unavailableReason: "not-installed",
    });

    const response = await GET(request);

    await expect(response.json()).resolves.toMatchObject({
      capabilities: {
        voice: {
          available: false,
          installed: false,
          unavailableReason: "not-installed",
        },
      },
    });
  });
});
