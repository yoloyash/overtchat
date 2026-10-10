import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
vi.mock("server-only", () => ({}));
import {
  runImageProvider,
  type ImageConnection,
} from "@/lib/providers/server/image-generation";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";
let server: Server;
let baseUrl: string;
let reply: unknown;
let rawReply: string | undefined;
let status: number;
let hold: boolean;
const requests: Array<{
  path: string;
  auth?: string;
  contentType?: string;
  body: string;
}> = [];
beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    requests.push({
      path: req.url!,
      auth: req.headers.authorization,
      contentType: req.headers["content-type"],
      body,
    });
    if (hold) return;
    res.writeHead(status, {
      "Content-Type": "application/json",
      ...(status === 302 ? { Location: `${baseUrl}/redirect-target` } : {}),
    });
    res.end(rawReply ?? JSON.stringify(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  requests.length = 0;
  reply = { data: [{ b64_json: png }] };
  rawReply = undefined;
  status = 200;
  hold = false;
});
const input = {
  prompt: "A kite",
  references: [],
  size: "1024x1024" as const,
  quality: "low" as const,
};
function connection(
  providerOptions: Record<string, unknown> = {},
): ImageConnection {
  return {
    providerId: "custom",
    model: "flux2-klein-4b",
    baseUrl,
    apiKey: null,
    providerOptions,
  };
}

describe("custom OpenAI Images HTTP contract", () => {
  it("sends an exact Halogen-compatible request without authentication", async () => {
    const image = await runImageProvider(
      connection({ size: "512x512", extraBody: { seed: 7 } }),
      input,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe("/v1/images/generations");
    expect(requests[0].auth).toBeUndefined();
    expect(JSON.parse(requests[0].body)).toEqual({
      model: "flux2-klein-4b",
      prompt: "A kite",
      n: 1,
      size: "512x512",
      seed: 7,
      response_format: "b64_json",
    });
    expect(image.data).toEqual(Buffer.from(png, "base64"));
    expect(image.mediaType).toBe("image/png");
  });
  it("uses backend defaults regardless of model/user size or quality suggestions", async () => {
    await runImageProvider(connection(), input);
    expect(JSON.parse(requests[0].body)).toEqual({
      model: "flux2-klein-4b",
      prompt: "A kite",
      n: 1,
      response_format: "b64_json",
    });
  });
  it("handles inline URL responses and explicit credentials", async () => {
    reply = { data: [{ url: `data:image/png;base64,${png}` }] };
    const image = await runImageProvider(
      { ...connection({ responseFormat: "url" }), apiKey: "test-only-key" },
      input,
    );
    expect(requests[0].auth).toBe("Bearer test-only-key");
    expect(JSON.parse(requests[0].body).response_format).toBe("url");
    expect(image.data).toEqual(Buffer.from(png, "base64"));
  });
  it("sends multipart edits only when enabled", async () => {
    const edit = { ...input, references: [Buffer.from(png, "base64")] };
    await expect(runImageProvider(connection(), edit)).rejects.toThrow(
      "does not support editing",
    );
    expect(requests).toHaveLength(0);
    await runImageProvider(
      connection({
        supportsEditing: true,
        size: "512x512",
        extraBody: { seed: 7 },
      }),
      edit,
    );
    expect(requests[0].path).toBe("/v1/images/edits");
    expect(requests[0].contentType).toContain("multipart/form-data");
    expect(requests[0].body).toContain('name="image[]"');
    expect(requests[0].body).toContain('name="seed"\r\n\r\n7');
    expect(requests[0].body).toContain("Content-Type: image/png");
  });
  it.each([
    { data: [] },
    { data: [{ b64_json: png }, { b64_json: png }] },
    { data: [{ b64_json: "not-base64" }] },
    {
      data: [{ b64_json: Buffer.from("<html>bad</html>").toString("base64") }],
    },
    { data: [{ url: `data:image/jpeg;base64,${png}` }] },
    { data: [{ url: "http://127.0.0.1/private" }] },
    { data: [{ url: "https://example.com/image.png" }] },
  ])(
    "rejects malformed or remote output without another request: %j",
    async (body) => {
      reply = body;
      await expect(runImageProvider(connection(), input)).rejects.toThrow();
      expect(requests).toHaveLength(1);
    },
  );
  it("does not expose malformed provider response bodies", async () => {
    rawReply = "private backend details: not JSON";
    await expect(runImageProvider(connection(), input)).rejects.toThrow(
      "The image provider returned invalid JSON.",
    );
    expect(requests).toHaveLength(1);
  });
  it("bounds large responses before parsing", async () => {
    reply = { data: [{ b64_json: "A".repeat(32 * 1024 * 1024) }] };
    await expect(runImageProvider(connection(), input)).rejects.toThrow(
      /too large|size limit/,
    );
    expect(requests).toHaveLength(1);
  });
  it.each([302, 400, 503])(
    "never retries or exposes provider bodies on HTTP %s",
    async (code) => {
      status = code;
      reply = { error: "private backend details test-only-key" };
      await expect(runImageProvider(connection(), input)).rejects.not.toThrow(
        "private backend",
      );
      expect(requests).toHaveLength(1);
    },
  );
  it("cancels an in-flight operation without replay", async () => {
    hold = true;
    const controller = new AbortController();
    const operation = runImageProvider(connection(), input, controller.signal);
    // Attach a rejection handler before aborting.
    const rejected = expect(operation).rejects.toThrow("stopped");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    controller.abort();
    await rejected;
    expect(requests).toHaveLength(1);
  });
});
