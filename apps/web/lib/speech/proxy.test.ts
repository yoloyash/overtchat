import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { capability } = vi.hoisted(() => ({ capability: vi.fn() }));
vi.mock("@/lib/db/serverCapabilities", () => ({ getServerCapability: capability }));
import { proxySpeech, proxyTranscription } from "./proxy";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("bundled speech transport", () => {
  it.each(["mp3", "pcm"] as const)("streams %s through the private host endpoint", async (format) => {
    capability.mockReturnValue({ provider: "bundled", apiKey: "stale-external-key" });
    vi.stubEnv("OVERTCHAT_BUNDLED_TTS_URL", "http://host.docker.internal:5093");
    vi.stubEnv("OVERTCHAT_BUNDLED_SPEECH_TOKEN", "internal-token");
    vi.stubEnv("KOKORO_URL", "https://external.example/v1");
    const upstream = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", upstream);
    const request = new Request("http://app/speech", { method: "POST", body: JSON.stringify({ text: "Hello" }) });
    const response = await proxySpeech(request, format);
    expect(upstream).toHaveBeenCalledWith("http://host.docker.internal:5093/v1/audio/speech", expect.objectContaining({
      headers: { "Content-Type": "application/json", Authorization: "Bearer internal-token" }, signal: request.signal,
    }));
    expect(JSON.parse(upstream.mock.calls[0][1].body).response_format).toBe(format);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("preserves mobile multipart audio and the default JSON response", async () => {
    capability.mockReturnValue({ provider: "bundled", apiKey: null });
    vi.stubEnv("OVERTCHAT_BUNDLED_STT_URL", "http://host.docker.internal:5093");
    vi.stubEnv("OVERTCHAT_BUNDLED_SPEECH_TOKEN", "internal-token");
    const upstream = vi.fn().mockResolvedValue(Response.json({ text: "Hello" }));
    vi.stubGlobal("fetch", upstream);
    const body = new FormData();
    body.set("file", new File(["audio"], "recording.m4a", { type: "audio/mp4" }));
    const response = await proxyTranscription(new Request("http://app/stt", { method: "POST", body }));
    const [url, options] = upstream.mock.calls[0];
    expect(url).toBe("http://host.docker.internal:5093/v1/audio/transcriptions");
    expect(options.headers.Authorization).toBe("Bearer internal-token");
    expect(options.body.get("file").name).toBe("recording.m4a");
    expect(await options.body.get("file").text()).toBe("audio");
    expect(options.body.get("response_format")).toBeNull();
    expect(await response.json()).toEqual({ text: "Hello" });
  });

  it("keeps external provider credentials and URLs independent", async () => {
    capability.mockReturnValue({ provider: "openai-compatible", baseUrl: "https://external.example/v1", apiKey: "provider-key" });
    vi.stubEnv("OVERTCHAT_BUNDLED_TTS_URL", "http://host.docker.internal:5093");
    vi.stubEnv("OVERTCHAT_BUNDLED_SPEECH_TOKEN", "internal-token");
    const upstream = vi.fn().mockResolvedValue(new Response("audio"));
    vi.stubGlobal("fetch", upstream);
    await proxySpeech(new Request("http://app/speech", { method: "POST", body: JSON.stringify({ input: "Hello" }) }), "mp3");
    expect(upstream.mock.calls[0][0]).toBe("https://external.example/v1/audio/speech");
    expect(upstream.mock.calls[0][1].headers.Authorization).toBe("Bearer provider-key");
  });

  it("retains Docker defaults when native speech is absent", async () => {
    capability.mockReturnValue({ provider: "bundled", apiKey: null });
    vi.stubEnv("OVERTCHAT_BUNDLED_TTS_URL", "");
    vi.stubEnv("OVERTCHAT_BUNDLED_SPEECH_TOKEN", "");
    vi.stubEnv("KOKORO_URL", "https://previous-external.example");
    const upstream = vi.fn().mockResolvedValue(new Response("audio"));
    vi.stubGlobal("fetch", upstream);
    await proxySpeech(new Request("http://app/speech", { method: "POST", body: JSON.stringify({ input: "Hello" }) }), "mp3");
    expect(upstream.mock.calls[0][0]).toBe("http://kokoro:8880/v1/audio/speech");
    expect(upstream.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});
