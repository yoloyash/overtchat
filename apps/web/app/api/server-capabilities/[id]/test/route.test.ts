import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCapability: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/serverCapabilities", () => ({
  getServerCapability: mocks.getCapability,
}));

import { POST } from "./route";

const draft = {
  provider: "openai-compatible",
  bundledInstalled: false,
  baseUrl: "https://draft.example/v1",
  apiKey: null,
  model: "tts-1",
  voice: "alloy",
};

function testRequest(id = "tts", body: unknown = draft) {
  return POST(
    new Request(`http://app/api/server-capabilities/${id}/test`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  mocks.getSession.mockResolvedValue({ user: { role: "admin" } });
  mocks.getCapability.mockReturnValue({
    ...draft,
    baseUrl: "https://saved.example",
    apiKey: "stored-key",
    model: "stored-model",
    voice: "stored-voice",
  });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("speech connection test", () => {
  it.each([
    [null, 401],
    [{ user: { role: "user" } }, 403],
  ])("requires an administrator", async (session, status) => {
    mocks.getSession.mockResolvedValue(session);
    expect((await testRequest()).status).toBe(status);
    expect(mocks.getCapability).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["search", "unknown"])(
    "rejects unsupported capability %s",
    async (id) => {
      expect((await testRequest(id)).status).toBe(404);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    [],
    { ...draft, provider: "bogus" },
    { ...draft, provider: "disabled" },
    { ...draft, baseUrl: "" },
    { ...draft, baseUrl: null },
    { ...draft, baseUrl: "file:///tmp/audio" },
    { ...draft, model: "" },
    { ...draft, voice: "" },
  ])(
    "rejects invalid drafts without falling back to saved values",
    async (body) => {
      expect((await testRequest("tts", body)).status).toBe(400);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([null, "", "draft-key"])(
    "tests draft values with key %s",
    async (apiKey) => {
      const cancel = vi.fn();
      mocks.fetch.mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
            },
            cancel,
          }),
          { headers: { "content-type": "audio/mpeg" } },
        ),
      );
      const response = await testRequest("tts", { ...draft, apiKey });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        message: expect.stringContaining("successful"),
      });
      const [url, init] = mocks.fetch.mock.calls[0];
      expect(url).toBe("https://draft.example/v1/audio/speech");
      expect(init.headers.Authorization).toBe(
        `Bearer ${apiKey || "stored-key"}`,
      );
      expect(JSON.parse(init.body)).toMatchObject({
        model: "tts-1",
        voice: "alloy",
      });
      expect(cancel).toHaveBeenCalled();
    },
  );

  it("uses bundled credentials and endpoint, ignoring external values", async () => {
    mocks.getCapability.mockReturnValue({ ...draft, bundledInstalled: true });
    vi.stubEnv("OVERTCHAT_BUNDLED_TTS_URL", "http://host.docker.internal:5093");
    vi.stubEnv("OVERTCHAT_BUNDLED_SPEECH_TOKEN", "internal-token");
    mocks.fetch.mockResolvedValue(
      new Response("audio", { headers: { "content-type": "audio/mpeg" } }),
    );
    expect(
      (
        await testRequest("tts", {
          ...draft,
          provider: "bundled",
          model: "kokoro",
          voice: "af_heart",
        })
      ).status,
    ).toBe(200);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("http://host.docker.internal:5093/v1/audio/speech");
    expect(init.headers.Authorization).toBe("Bearer internal-token");
  });

  it("does not trust bundled installation state from the client", async () => {
    expect(
      (
        await testRequest("tts", {
          ...draft,
          provider: "bundled",
          bundledInstalled: true,
        })
      ).status,
    ).toBe(409);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["tts", "stt"])("reports upstream failures for %s", async (id) => {
    mocks.fetch.mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    expect((await testRequest(id)).status).toBe(502);
  });

  it.each(["text/html", "application/json", "audio/mpeg"])(
    "rejects invalid or empty TTS responses (%s)",
    async (contentType) => {
      mocks.fetch.mockResolvedValue(
        new Response(contentType === "audio/mpeg" ? "" : "not audio", {
          headers: { "content-type": contentType },
        }),
      );
      expect((await testRequest()).status).toBe(502);
    },
  );

  it("sends valid silent WAV audio and accepts an empty transcript", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ text: "" }));
    const response = await testRequest("stt", {
      ...draft,
      model: "whisper-1",
      voice: null,
    });
    expect(response.status).toBe(200);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://draft.example/v1/audio/transcriptions");
    expect(init.body.get("model")).toBe("whisper-1");
    expect(init.body.get("response_format")).toBe("json");
    const audio = Buffer.from(await init.body.get("file").arrayBuffer());
    expect(audio.toString("ascii", 0, 4)).toBe("RIFF");
    expect(audio.readUInt32LE(40)).toBe(audio.length - 44);
    expect(audio.subarray(44).every((sample: number) => sample === 0)).toBe(
      true,
    );
  });

  it.each(["<html>Not an API</html>", "{}", '{"text":null}'])(
    "rejects invalid STT responses",
    async (body) => {
      mocks.fetch.mockResolvedValue(new Response(body));
      expect((await testRequest("stt")).status).toBe(502);
    },
  );

  it("reports timeouts", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort(new DOMException("Timed out", "TimeoutError")),
    );
    mocks.fetch.mockRejectedValue(
      new DOMException("Timed out", "TimeoutError"),
    );
    const response = await testRequest();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "The connection test timed out or was cancelled.",
    });
  });
});
