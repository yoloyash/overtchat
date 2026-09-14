import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { ImageGenerationOutput } from "@overtchat/shared";
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  read: vi.fn(),
  store: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/modelConfigs", () => ({
  getImageModelConfig: mocks.config,
}));
vi.mock("@/lib/db/uploads", () => ({
  readFetchedImage: mocks.read,
  storeFetchedImage: mocks.store,
}));
vi.mock("@/lib/providers/server/image-generation", () => ({
  runImageProvider: mocks.generate,
}));
import { createImageTools, withImageReferences } from "./tools";

const execution = { toolCallId: "call", messages: [], context: {} };
const attached: UIMessage[] = [
  {
    id: "user",
    role: "user",
    parts: [
      {
        type: "file",
        mediaType: "image/png",
        filename: "reference.png",
        url: "/api/uploads/reference",
      },
      { type: "text", text: "Make the sky blue" },
    ],
  },
];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({
    providerId: "openai",
    baseUrl: "http://images/v1",
    apiKey: null,
    model: "image-model",
  });
  mocks.read.mockResolvedValue({
    data: new Uint8Array([1, 2]),
    mediaType: "image/png",
    filename: "reference.png",
  });
  mocks.store.mockResolvedValue({ uploadUrl: "/api/uploads/generated" });
  mocks.generate.mockResolvedValue({
    data: new Uint8Array([3, 4]),
    mediaType: "image/png",
  });
});

describe("image tools", () => {
  it("resolves references through owner-scoped storage and applies explicit user settings", async () => {
    const tools = createImageTools({
      userId: "alice",
      messages: attached,
      supportsImageInput: false,
      options: { size: "1024x1536", quality: "low" },
    });
    const output = (await tools.edit_image.execute!(
      { prompt: "Blue sky", image_ids: ["reference"], quality: "high" },
      execution,
    )) as ImageGenerationOutput;
    expect(mocks.read).toHaveBeenCalledWith("/api/uploads/reference", "alice");
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        references: [new Uint8Array([1, 2])],
        size: "1024x1536",
        quality: "low",
      }),
      undefined,
    );
    expect(mocks.store).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "alice" }),
    );
    expect(output.referenceImageIds).toEqual(["reference"]);
    expect(output.images[0].url).toBe("/api/uploads/generated");
  });

  it("rejects references outside the conversation and another user's uploads", async () => {
    const tools = createImageTools({
      userId: "alice",
      messages: attached,
      supportsImageInput: false,
    });
    await expect(
      tools.edit_image.execute!(
        { prompt: "Edit", image_ids: ["unrelated"] },
        execution,
      ),
    ).rejects.toThrow("not attached");
    mocks.read.mockResolvedValue(null);
    await expect(
      tools.edit_image.execute!(
        { prompt: "Edit", image_ids: ["reference"] },
        execution,
      ),
    ).rejects.toThrow("unavailable");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("keeps image IDs available to text-only models without sending image bytes", () => {
    const converted = withImageReferences(attached, false);
    expect(converted[0].parts.every((part) => part.type !== "file")).toBe(true);
    expect(JSON.stringify(converted)).toContain("reference.png");
    expect(withImageReferences(attached, true)[0].parts[0].type).toBe("file");
    expect(attached[0].parts[0].type).toBe("file");
  });

  it("shows new results to vision models, and only retains IDs in later turns", async () => {
    const tools = createImageTools({
      userId: "alice",
      messages: [],
      supportsImageInput: true,
    });
    const output = (await tools.generate_image.execute!(
      { prompt: "A kite" },
      execution,
    )) as ImageGenerationOutput;
    const toModel = { toolCallId: "call", input: { prompt: "A kite" }, output };
    const current = await tools.generate_image.toModelOutput!(toModel);
    expect(JSON.stringify(current)).toContain('"type":"file"');
    const history: UIMessage[] = [
      {
        id: "assistant",
        role: "assistant",
        parts: [
          {
            type: "tool-generate_image",
            toolCallId: "call",
            state: "output-available",
            input: toModel.input,
            output,
          },
        ],
      },
    ];
    const next = createImageTools({
      userId: "alice",
      messages: history,
      supportsImageInput: true,
    });
    const replay = await next.generate_image.toModelOutput!(toModel);
    expect(JSON.stringify(replay)).not.toContain('"type":"file"');
    await next.edit_image.execute!(
      { prompt: "Make it blue", image_ids: ["generated"] },
      execution,
    );
    expect(mocks.read).toHaveBeenLastCalledWith(
      "/api/uploads/generated",
      "alice",
    );
  });

  it("passes cancellation to the provider and does not store failed results", async () => {
    const controller = new AbortController();
    mocks.generate.mockRejectedValue(new Error("Image generation stopped."));
    const tools = createImageTools({
      userId: "alice",
      messages: [],
      supportsImageInput: false,
    });
    await expect(
      tools.generate_image.execute!(
        { prompt: "A kite" },
        { ...execution, abortSignal: controller.signal },
      ),
    ).rejects.toThrow("stopped");
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      controller.signal,
    );
    expect(mocks.store).not.toHaveBeenCalled();
  });
});

it("does not call an image provider after the active image model is disabled", async () => {
  mocks.config.mockReturnValue(null);
  const tools = createImageTools({
    userId: "alice",
    messages: [],
    supportsImageInput: false,
  });
  await expect(
    tools.generate_image.execute!({ prompt: "A kite" }, execution),
  ).rejects.toThrow("Settings → Models");
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("uses Gemini defaults for quality instead of claiming OpenAI quality was applied", async () => {
  mocks.config.mockReturnValue({
    providerId: "google",
    baseUrl: "http://images/v1",
    apiKey: "key",
    model: "gemini-3.1-flash-image",
  });
  const tools = createImageTools({
    userId: "alice",
    messages: [],
    supportsImageInput: false,
    options: { size: "1536x1024", quality: "high" },
  });
  const result = await tools.generate_image.execute!(
    { prompt: "A kite" },
    execution,
  );
  expect(result).toMatchObject({ quality: "auto", size: "1536x1024" });
});
