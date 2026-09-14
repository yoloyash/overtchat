import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runImageProvider } from "@/lib/providers/server/image-generation";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";
const connection = {
  providerId: "openai" as const,
  baseUrl: "https://images.example/v1/",
  apiKey: "secret-key",
  model: "gpt-image-1",
};
const options = {
  prompt: "A red kite",
  references: [],
  size: "auto" as const,
  quality: "auto" as const,
};
afterEach(() => vi.unstubAllGlobals());

describe("image provider", () => {
  it.each(["gpt-image-1", "studio-art"])(
    "uses the Images endpoint with model ID %s and preserves usage",
    async (model) => {
      const fetch = vi.fn().mockResolvedValue(
        Response.json({
          data: [{ b64_json: png }],
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        }),
      );
      vi.stubGlobal("fetch", fetch);
      const result = await runImageProvider({ ...connection, model }, options);
      expect(result.mediaType).toBe("image/png");
      expect(result.usage?.totalTokens).toBe(30);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe("https://images.example/v1/images/generations");
      expect(JSON.parse(init.body)).toEqual({
        model,
        prompt: "A red kite",
        n: 1,
        ...(model === "studio-art" ? { response_format: "b64_json" } : {}),
      });
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer secret-key",
      );
      expect(init.redirect).toBe("error");
    },
  );

  it.each(["gpt-image-1", "studio-art"])(
    "edits with model ID %s and owned reference bytes",
    async (model) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(Response.json({ data: [{ b64_json: png }] }));
      vi.stubGlobal("fetch", fetch);
      await runImageProvider(
        { ...connection, model },
        {
          ...options,
          references: [Buffer.from(png, "base64")],
          size: "1536x1024",
          quality: "high",
        },
      );
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe("https://images.example/v1/images/edits");
      const form = init.body as FormData;
      expect(form.get("model")).toBe(model);
      expect(form.get("size")).toBe("1536x1024");
      expect(form.get("quality")).toBe("high");
      const image = Array.from(form.values()).find(
        (value) => value instanceof Blob,
      ) as Blob;
      expect(Buffer.from(await image.arrayBuffer())).toEqual(
        Buffer.from(png, "base64"),
      );
    },
  );

  it("does not retry errors or expose configured credentials", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          Response.json(
            { error: { message: "Rejected secret-key", type: "server_error" } },
            { status: 503 },
          ),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(runImageProvider(connection, options)).rejects.toThrow(
      "Rejected [redacted]",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects non-image provider output before storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: [
            {
              b64_json: Buffer.from("<html>not an image</html>").toString(
                "base64",
              ),
            },
          ],
        }),
      ),
    );
    await expect(runImageProvider(connection, options)).rejects.toThrow();
  });

  it("bounds streamed response bodies before JSON parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
          }),
        ),
      ),
    );
    await expect(runImageProvider(connection, options)).rejects.toThrow(
      /too large|parse/i,
    );
  });
});

describe("Gemini image provider", () => {
  const google = {
    ...connection,
    providerId: "google" as const,
    model: "gemini-3.1-flash-image",
  };
  const response = () =>
    Response.json({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ inlineData: { mimeType: "image/png", data: png } }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    });

  it.each(["gemini-3.1-flash-image", "studio-art"])(
    "uses generateContent with model ID %s and Gemini settings",
    async (model) => {
      const fetch = vi.fn().mockImplementation(async () => response());
      vi.stubGlobal("fetch", fetch);
      const result = await runImageProvider(
        { ...google, model },
        {
          ...options,
          size: "1536x1024",
          quality: "high",
        },
      );
      expect(result.mediaType).toBe("image/png");
      expect(result.usage?.totalTokens).toBe(30);
      const [url, init] = fetch.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(
        `https://images.example/v1/models/${model}:generateContent`,
      );
      expect(new Headers(init.headers).get("x-goog-api-key")).toBe(
        "secret-key",
      );
      expect(new Headers(init.headers).has("authorization")).toBe(false);
      const body = JSON.parse(init.body as string);
      expect(body.generationConfig.responseModalities).toEqual(["IMAGE"]);
      expect(body.generationConfig.imageConfig.aspectRatio).toBe("3:2");
      expect(body).not.toHaveProperty("quality");
      expect(body).not.toHaveProperty("size");
    },
  );

  it.each(["gemini-3.1-flash-image", "studio-art"])(
    "passes reference bytes to generateContent with model ID %s",
    async (model) => {
      const fetch = vi.fn().mockImplementation(async () => response());
      vi.stubGlobal("fetch", fetch);
      await runImageProvider(
        { ...google, model },
        {
          ...options,
          references: [Buffer.from(png, "base64")],
        },
      );
      const [url, init] = fetch.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(
        `https://images.example/v1/models/${model}:generateContent`,
      );
      const parts = JSON.parse(init.body as string).contents[0].parts;
      expect(parts).toContainEqual({ text: options.prompt });
      expect(parts).toContainEqual({
        inlineData: { mimeType: "image/png", data: png },
      });
    },
  );

  it("fails clearly on text-only or blocked output without retrying", async () => {
    const fetch = vi.fn().mockImplementation(async () =>
      Response.json({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Cannot produce that image" }],
            },
            finishReason: "STOP",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(runImageProvider(google, options)).rejects.toThrow(/image/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
