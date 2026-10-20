import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { capability } = vi.hoisted(() => ({ capability: vi.fn() }));
vi.mock("@/lib/db/serverCapabilities", () => ({
  getServerCapability: capability,
}));
import { proxySpeech, proxyTranscription } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("bundled speech transport", () => {
  it.each(["mp3", "pcm"] as const)(
    "streams %s through the private host endpoint",
    async (format) => {
      capability.mockReturnValue({
        provider: "bundled",
        apiKey: "stale-external-key",
      });
      vi.stubEnv(
        "OVERTCHAT_BUNDLED_TTS_URL",
        "http://host.docker.internal:5093",
      );
      vi.stubEnv("OVERTCHAT_BUNDLED_SPEECH_TOKEN", "internal-token");
      vi.stubEnv("KOKORO_URL", "https://external.example/v1");
      const upstream = vi
        .fn()
        .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
      vi.stubGlobal("fetch", upstream);
      const request = new Request("http://app/speech", {
        method: "POST",
        body: JSON.stringify({ text: "Hello" }),
      });
      const response = await proxySpeech(request, format);
      expect(upstream).toHaveBeenCalledWith(
        "http://host.docker.internal:5093/v1/audio/speech",
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer internal-token",
          },
          signal: expect.any(AbortSignal),
        }),
      );
      expect(JSON.parse(upstream.mock.calls[0][1].body).response_format).toBe(
        format,
      );
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
        1, 2, 3,
      ]);
    },
  );

  it("preserves mobile multipart audio and the default JSON response", async () => {
    capability.mockReturnValue({ provider: "bundled", apiKey: null });
    vi.stubEnv("OVERTCHAT_BUNDLED_STT_URL", "http://host.docker.internal:5093");
    vi.stubEnv("OVERTCHAT_BUNDLED_SPEECH_TOKEN", "internal-token");
    const upstream = vi
      .fn()
      .mockResolvedValue(Response.json({ text: "Hello" }));
    vi.stubGlobal("fetch", upstream);
    const body = new FormData();
    body.set(
      "file",
      new File(["audio"], "recording.m4a", { type: "audio/mp4" }),
    );
    const response = await proxyTranscription(
      new Request("http://app/stt", { method: "POST", body }),
    );
    const [url, options] = upstream.mock.calls[0];
    expect(url).toBe(
      "http://host.docker.internal:5093/v1/audio/transcriptions",
    );
    expect(options.headers.Authorization).toBe("Bearer internal-token");
    expect(options.body.get("file").name).toBe("recording.m4a");
    expect(await options.body.get("file").text()).toBe("audio");
    expect(options.body.get("response_format")).toBeNull();
    expect(await response.json()).toEqual({ text: "Hello" });
  });

  it("identifies explicitly disabled transcription", async () => {
    capability.mockReturnValue({
      provider: "disabled",
      baseUrl: null,
      apiKey: null,
    });
    const body = new FormData();
    body.set(
      "file",
      new File(["audio"], "recording.webm", { type: "audio/webm" }),
    );
    const response = await proxyTranscription(
      new Request("http://app/stt", { method: "POST", body }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Dictation is turned off on this server.",
      code: "speech_disabled",
    });
  });

  it("keeps external provider credentials and URLs independent", async () => {
    capability.mockReturnValue({
      provider: "openai-compatible",
      baseUrl: "https://external.example/v1",
      apiKey: "provider-key",
    });
    vi.stubEnv("OVERTCHAT_BUNDLED_TTS_URL", "http://host.docker.internal:5093");
    vi.stubEnv("OVERTCHAT_BUNDLED_SPEECH_TOKEN", "internal-token");
    const upstream = vi.fn().mockResolvedValue(new Response("audio"));
    vi.stubGlobal("fetch", upstream);
    await proxySpeech(
      new Request("http://app/speech", {
        method: "POST",
        body: JSON.stringify({ input: "Hello" }),
      }),
      "mp3",
    );
    expect(upstream.mock.calls[0][0]).toBe(
      "https://external.example/v1/audio/speech",
    );
    expect(upstream.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer provider-key",
    );
  });

  it("retains Docker defaults when native speech is absent", async () => {
    capability.mockReturnValue({ provider: "bundled", apiKey: null });
    vi.stubEnv("OVERTCHAT_BUNDLED_TTS_URL", "");
    vi.stubEnv("OVERTCHAT_BUNDLED_SPEECH_TOKEN", "");
    vi.stubEnv("KOKORO_URL", "https://previous-external.example");
    const upstream = vi.fn().mockResolvedValue(new Response("audio"));
    vi.stubGlobal("fetch", upstream);
    await proxySpeech(
      new Request("http://app/speech", {
        method: "POST",
        body: JSON.stringify({ input: "Hello" }),
      }),
      "mp3",
    );
    expect(upstream.mock.calls[0][0]).toBe(
      "http://kokoro:8880/v1/audio/speech",
    );
    expect(upstream.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

const configured = {
  provider: "openai-compatible",
  baseUrl: "https://speech.example/v1",
  apiKey: "private-key",
  model: null,
  voice: null,
};
function transcribeRequest(signal?: AbortSignal) {
  const body = new FormData();
  body.set(
    "file",
    new File(["audio"], "recording.webm", { type: "audio/webm" }),
  );
  return new Request("http://app/transcribe", { method: "POST", body, signal });
}
function speechRequest(signal?: AbortSignal) {
  return new Request("http://app/tts", {
    method: "POST",
    body: JSON.stringify({ text: "Hello" }),
    signal,
  });
}

for (const service of ["stt", "tts"] as const) {
  const call = (signal?: AbortSignal) =>
    service === "stt"
      ? proxyTranscription(transcribeRequest(signal))
      : proxySpeech(speechRequest(signal), "mp3");

  describe(`${service} failure classification`, () => {
    it("distinguishes a configured unreachable endpoint from missing setup", async () => {
      capability.mockReturnValue(configured);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      );
      const response = await call();
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.code).toBe("speech_unreachable");
      expect(body.error).toContain("Couldn't reach");
      expect(body.error).not.toMatch(/set up|setup|configured/);
    });

    it("reports missing configuration only when no endpoint is configured", async () => {
      capability.mockReturnValue({ ...configured, baseUrl: null });
      vi.stubEnv("STT_URL", "");
      vi.stubEnv("KOKORO_URL", "");
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const response = await call();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "speech_not_configured",
      });
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      [401, 502, "speech_provider_auth"],
      [403, 502, "speech_provider_auth"],
      [429, 429, "speech_rate_limited"],
      [503, 502, "speech_provider_error"],
      [504, 504, "speech_timeout"],
      [400, 502, "speech_provider_error"],
    ])(
      "normalizes upstream %i without exposing its body",
      async (status, expectedStatus, code) => {
        capability.mockReturnValue(configured);
        vi.stubGlobal(
          "fetch",
          vi
            .fn()
            .mockResolvedValue(
              new Response("<html>private-key internal-host traceback</html>", {
                status: status as number,
              }),
            ),
        );
        const response = await call();
        expect(response.status).toBe(expectedStatus);
        const body = await response.json();
        expect(body.code).toBe(code);
        expect(JSON.stringify(body)).not.toMatch(
          /private-key|internal-host|traceback|<html>/,
        );
      },
    );

    it("does not turn caller cancellation into an outage", async () => {
      capability.mockReturnValue(configured);
      const controller = new AbortController();
      controller.abort();
      const error = new DOMException("Cancelled", "AbortError");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
      await expect(call(controller.signal)).rejects.toBe(error);
    });

    it("allows a slow provider to finish without imposing a new deadline", async () => {
      vi.useFakeTimers();
      try {
        capability.mockReturnValue(configured);
        let signal: AbortSignal | undefined;
        vi.stubGlobal("fetch", vi.fn((_url, init) => {
          signal = init.signal;
          return new Promise((resolve) => setTimeout(() => resolve(
            service === "stt"
              ? Response.json({ text: "Hello" })
              : new Response("audio", { headers: { "content-type": "audio/mpeg" } }),
          ), 90_000));
        }));
        const result = call();
        await vi.advanceTimersByTimeAsync(90_000);
        expect((await result).status).toBe(200);
        expect(signal?.aborted).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });
}

it("does not turn a malformed successful transcription into 'no speech detected'", async () => {
  capability.mockReturnValue(configured);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ message: "model loading" })),
  );
  const response = await proxyTranscription(transcribeRequest());
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({
    code: "speech_invalid_response",
  });
});

it("preserves text responses used by speech API consumers", async () => {
  capability.mockReturnValue(configured);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("Hello", { headers: { "content-type": "text/plain" } }),
      ),
  );
  const form = new FormData();
  form.set("file", new File(["audio"], "recording.wav"));
  form.set("response_format", "text");
  const response = await proxyTranscription(
    new Request("http://app/transcribe", { method: "POST", body: form }),
  );
  expect(await response.text()).toBe("Hello");
});

it("does not time out successful streaming playback after headers arrive", async () => {
  vi.useFakeTimers();
  try {
    capability.mockReturnValue(configured);
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        signal = init.signal;
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "audio/mpeg" },
        });
      }),
    );
    const response = await proxySpeech(speechRequest(), "mp3");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(signal?.aborted).toBe(false);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      1, 2, 3,
    ]);
  } finally {
    vi.useRealTimers();
  }
});
