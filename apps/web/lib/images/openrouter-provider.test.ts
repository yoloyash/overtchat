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
// The shape OpenRouter returned for qwen/qwen-image-2.1-turbo on 2026-10-31.
const usage = {
  prompt_tokens: 12,
  completion_tokens: 4_175,
  total_tokens: 4_187,
  cost: 0.0184,
  is_byok: false,
  prompt_tokens_details: { cached_tokens: 0 },
  cost_details: {
    upstream_inference_cost: 0.0184,
    upstream_inference_prompt_cost: 0,
    upstream_inference_completions_cost: 0.0184,
  },
  completion_tokens_details: { reasoning_tokens: 0, image_tokens: 4_175 },
};
let server: Server;
let baseUrl: string;
let reply: unknown;
let status: number;
const requests: Array<{
  path: string;
  method?: string;
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
      method: req.method,
      auth: req.headers.authorization,
      contentType: req.headers["content-type"],
      body,
    });
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  requests.length = 0;
  reply = {
    created: 1,
    data: [{ b64_json: png, media_type: "image/png" }],
    usage,
  };
  status = 200;
});
const input = {
  prompt: "A kite",
  references: [],
  size: "auto" as const,
  quality: "auto" as const,
};
function connection(): ImageConnection {
  return {
    providerId: "openrouter",
    model: "qwen/qwen-image-2.1-turbo",
    baseUrl,
    apiKey: "router-key",
  };
}

describe("OpenRouter images HTTP contract", () => {
  it("posts to the images endpoint and records the reported charge", async () => {
    const image = await runImageProvider(connection(), input);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      path: "/api/v1/images",
      method: "POST",
      auth: "Bearer router-key",
      contentType: "application/json",
    });
    expect(JSON.parse(requests[0].body)).toEqual({
      model: "qwen/qwen-image-2.1-turbo",
      prompt: "A kite",
      n: 1,
    });
    expect(image.data).toEqual(Buffer.from(png, "base64"));
    expect(image.mediaType).toBe("image/png");
    expect(image.usage).toEqual({
      inputTokens: 12,
      outputTokens: 4_175,
      totalTokens: 4_187,
    });
    expect(image.reportedCost).toEqual({
      inputCostNanoUsd: 0,
      outputCostNanoUsd: 18_400_000,
      totalCostNanoUsd: 18_400_000,
    });
  });
  it("maps sizes to aspect ratios and forwards quality", async () => {
    await runImageProvider(connection(), {
      ...input,
      size: "1536x1024",
      quality: "high",
    });
    expect(JSON.parse(requests[0].body)).toMatchObject({
      aspect_ratio: "3:2",
      quality: "high",
    });
    await runImageProvider(connection(), { ...input, size: "1024x1536" });
    expect(JSON.parse(requests[1].body)).toMatchObject({ aspect_ratio: "2:3" });
    expect(JSON.parse(requests[1].body)).not.toHaveProperty("quality");
  });
  it("edits with inline reference images on the same endpoint", async () => {
    await runImageProvider(connection(), {
      ...input,
      references: [Buffer.from(png, "base64")],
    });
    expect(requests[0].path).toBe("/api/v1/images");
    expect(JSON.parse(requests[0].body).input_references).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } },
    ]);
  });
  it("splits the charge by the upstream prompt share when reported", async () => {
    reply = {
      data: [{ b64_json: png }],
      usage: {
        ...usage,
        cost: 0.03,
        cost_details: {
          upstream_inference_prompt_cost: 0.01,
          upstream_inference_completions_cost: 0.02,
        },
      },
    };
    expect((await runImageProvider(connection(), input)).reportedCost).toEqual({
      inputCostNanoUsd: 10_000_000,
      outputCostNanoUsd: 20_000_000,
      totalCostNanoUsd: 30_000_000,
    });
  });
  it("leaves the charge unknown when OpenRouter omits it", async () => {
    reply = {
      data: [{ b64_json: png }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    };
    const image = await runImageProvider(connection(), input);
    expect(image.reportedCost).toBeUndefined();
    expect(image.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
    reply = { data: [{ b64_json: png }] };
    const bare = await runImageProvider(connection(), input);
    expect(bare.usage).toBeUndefined();
    expect(bare.reportedCost).toBeUndefined();
  });
  it("rejects mismatched, multiple, or non-raster output", async () => {
    reply = { data: [{ b64_json: png, media_type: "image/jpeg" }] };
    await expect(runImageProvider(connection(), input)).rejects.toThrow(
      "mismatched image content",
    );
    reply = { data: [{ b64_json: png }, { b64_json: png }] };
    await expect(runImageProvider(connection(), input)).rejects.toThrow(
      "exactly one image",
    );
    reply = {
      data: [
        {
          b64_json: Buffer.from("<svg/>").toString("base64"),
          media_type: "image/svg+xml",
        },
      ],
    };
    await expect(runImageProvider(connection(), input)).rejects.toThrow(
      "unsupported image content",
    );
    reply = { data: [{ url: "https://cdn.example/kite.png" }] };
    await expect(runImageProvider(connection(), input)).rejects.toThrow(
      "did not return image data",
    );
  });
  it("surfaces OpenRouter's error message without the API key", async () => {
    status = 400;
    reply = {
      error: {
        message: "Provider rejected aspect_ratio for router-key",
        code: 400,
      },
    };
    await expect(runImageProvider(connection(), input)).rejects.toThrow(
      "Image provider request failed (HTTP 400): Provider rejected aspect_ratio for [redacted]",
    );
    status = 502;
    reply = "upstream unavailable";
    await expect(runImageProvider(connection(), input)).rejects.toThrow(
      "Image provider request failed (HTTP 502).",
    );
  });
});
