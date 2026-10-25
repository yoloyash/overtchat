import type { UIMessage } from "ai";
import { mapUploadReferences } from "./sharing-uploads";
import { describe, expect, it } from "vitest";
import { isGeneratedImage } from "@overtchat/shared";
import { isSharedGeneratedImage, sharedMessages } from "./sharing";

describe("shared content projection", () => {
  it("accepts only local, matching share-scoped images for public display, never model replay", () => {
    const image = {
      id: "image-id",
      filename: "image.png",
      mediaType: "image/png",
      url: "/api/share/00000000-0000-4000-8000-000000000000/files/image-id",
    };
    expect(isSharedGeneratedImage(image)).toBe(true);
    expect(isGeneratedImage(image)).toBe(false);
    for (const url of [
      "https://foreign.test/image.png",
      "javascript:alert(1)",
      `${image.url}/extra`,
      image.url.replace("image-id", "another-id"),
    ]) {
      expect(isSharedGeneratedImage({ ...image, url })).toBe(false);
    }
    expect(
      isSharedGeneratedImage({ ...image, mediaType: "image/svg+xml" }),
    ).toBe(false);
  });

  it("rewrites references in file parts, generated images, Markdown, and OpenUI without mutating the source", () => {
    const original: UIMessage[] = [
      {
        id: "m",
        role: "assistant",
        parts: [
          { type: "file", mediaType: "image/png", url: "/api/uploads/image" },
          {
            type: "tool-present_openui",
            toolCallId: "ui",
            state: "input-available",
            input: { ui: 'root = Image("alt", "/api/uploads/image")' },
          },
          { type: "text", text: "![picture](/api/uploads/image)" },
        ],
      },
    ];
    const result = mapUploadReferences(
      original,
      (id) => `/api/share/token/files/${id}`,
    );
    expect(JSON.stringify(result)).not.toContain("/api/uploads/");
    expect(
      JSON.stringify(result).match(/\/api\/share\/token\/files\/image/g),
    ).toHaveLength(3);
    expect(JSON.stringify(original)).toContain("/api/uploads/image");
  });

  it("preserves literal prose, inline/fenced code, tool data and saved form values", () => {
    const text =
      'Example /api/uploads/example and `/api/uploads/inline`.\n\n```js\nconst url = "/api/uploads/code";\n```';
    const original: UIMessage[] = [
      {
        id: "m",
        role: "assistant",
        parts: [
          { type: "text", text },
          {
            type: "dynamic-tool",
            toolName: "inspect",
            toolCallId: "t",
            state: "output-available",
            input: { url: "/api/uploads/input" },
            output: { url: "/api/uploads/output" },
          },
          {
            type: "tool-present_openui",
            toolCallId: "ui",
            state: "input-available",
            input: {
              ui: 'root = Card([Text("/api/uploads/text"), CodeBlock("js", "Image(\\\"alt\\\", \\\"/api/uploads/example\\\")")])',
            },
          },
        ],
        metadata: { value: "/api/uploads/form" },
      },
    ];
    const ids: string[] = [];
    expect(
      mapUploadReferences(original, (id) => {
        ids.push(id);
        return `/shared/${id}`;
      }),
    ).toEqual(original);
    expect(ids).toEqual([]);
  });

  it("maps Markdown destinations and used definitions without changing labels, code or foreign URLs", () => {
    const text =
      '[label /api/uploads/label](/api/uploads/file "title")\n\n![photo][ref]\n\n[ref]: /api/uploads/image\n[unused]: /api/uploads/unused\n\n[foreign](https://foreign.test/api/uploads/private)\n\n```txt\n/api/uploads/file\n```';
    const ids: string[] = [];
    const result = mapUploadReferences(
      [{ id: "m", role: "assistant", parts: [{ type: "text", text }] }],
      (id) => {
        ids.push(id);
        return `/shared/${id}`;
      },
    );
    expect(ids).toEqual(["file", "image"]);
    expect(result[0].parts[0]).toMatchObject({
      text: expect.stringContaining("label /api/uploads/label"),
    });
    expect(result[0].parts[0]).toMatchObject({
      text: expect.stringContaining("```txt\n/api/uploads/file\n```"),
    });
    expect(result[0].parts[0]).toMatchObject({
      text: expect.stringContaining("https://foreign.test/api/uploads/private"),
    });
  });

  it("resolves OpenUI image variables and galleries without rewriting text using the same variable", () => {
    const ui =
      'img = "/api/uploads/image"\nroot = Card([Image("alt", img), ImageBlock(img), ImageGallery([{src: img, alt: "test"}]), Text(img), CodeBlock("text", "/api/uploads/example")])';
    const ids: string[] = [];
    const result = mapUploadReferences(
      [
        {
          id: "m",
          role: "assistant",
          parts: [
            {
              type: "tool-present_openui",
              toolCallId: "ui",
              state: "input-available",
              input: { ui },
            },
          ],
        },
      ],
      (id) => {
        ids.push(id);
        return `/shared/${id}`;
      },
    );
    expect(ids).toEqual(["image", "image", "image"]);
    const json = JSON.stringify(result);
    expect(json).toContain("Text(img)");
    expect(json).toContain("/api/uploads/example");
    expect(json.match(/\/shared\/image/g)).toHaveLength(3);
  });

  it("rewrites nested linked images and rendered HTML without treating code as a file", () => {
    const text =
      '[![alt](/api/uploads/image)](/api/uploads/document)\n\n<img src="/api/uploads/photo">\n\n<pre><code>/api/uploads/example</code></pre>';
    const ids: string[] = [];
    const result = mapUploadReferences(
      [{ id: "m", role: "assistant", parts: [{ type: "text", text }] }],
      (id) => {
        ids.push(id);
        return `/shared/${id}`;
      },
    );
    expect(ids).toEqual(["image", "document", "photo"]);
    expect(result[0].parts[0]).toMatchObject({
      text: expect.stringContaining(
        "[![alt](/shared/image)](/shared/document)",
      ),
    });
    expect(result[0].parts[0]).toMatchObject({
      text: expect.stringContaining('<img src="/shared/photo">'),
    });
    expect(result[0].parts[0]).toMatchObject({
      text: expect.stringContaining("/api/uploads/example"),
    });
  });

  it("resolves static OpenUI image expressions and ignores unreachable components", () => {
    const ui =
      'data = {image: "/api/uploads/photo"}\nunused = ImageBlock("/api/uploads/unused")\nroot = Image("alt", data.image + "?download=1")';
    const ids: string[] = [];
    const result = mapUploadReferences(
      [
        {
          id: "m",
          role: "assistant",
          parts: [
            {
              type: "tool-present_openui",
              toolCallId: "ui",
              state: "input-available",
              input: { ui },
            },
          ],
        },
      ],
      (id) => {
        ids.push(id);
        return `/shared/${id}`;
      },
    );
    expect(ids).toEqual(["photo"]);
    expect(JSON.stringify(result)).toContain("/shared/photo?download=1");
    expect(JSON.stringify(result)).toContain("/api/uploads/unused");
  });

  it("preserves inline HTML anchor boundaries and text when rewriting its destination", () => {
    const text =
      'Read <a href="/api/uploads/document" title="A > B">the document</a>.';
    const result = mapUploadReferences(
      [{ id: "m", role: "assistant", parts: [{ type: "text", text }] }],
      (id) => `/shared/${id}`,
    );
    expect(result[0].parts[0]).toEqual({
      type: "text",
      text: 'Read <a href="/shared/document" title="A > B">the document</a>.',
    });
  });

  it("rewrites fetched image thumbnails without modifying their external source", () => {
    const output = {
      kind: "image",
      url: "https://example.com/photo.png",
      uploadUrl: "/api/uploads/fetched",
      filename: "photo.png",
      contentType: "image/png",
      byteLength: 4,
    };
    const ids: string[] = [];
    const result = mapUploadReferences(
      [
        {
          id: "m",
          role: "assistant",
          parts: [
            {
              type: "tool-fetch_url",
              toolCallId: "fetch",
              state: "output-available",
              input: { url: output.url },
              output,
            },
          ],
        },
      ],
      (id) => {
        ids.push(id);
        return `/shared/${id}`;
      },
    );
    expect(ids).toEqual(["fetched"]);
    expect(result[0].parts[0]).toMatchObject({
      output: { ...output, uploadUrl: "/shared/fetched" },
    });
    expect(output.uploadUrl).toBe("/api/uploads/fetched");
  });

  it("publishes document versions and file reads with their saved data", () => {
    const document = {
      type: "tool-create_document",
      toolCallId: "doc",
      state: "output-available",
      input: { title: "Plan", type: "markdown", content: "Body" },
      output: { id: "plan", title: "Plan", type: "markdown", version: 1, content: "Body" },
      providerExecuted: false,
    };
    const read = {
      type: "tool-read_file",
      toolCallId: "read",
      state: "output-available",
      input: { file: "a.txt" },
      output: { file: "a.txt", uploadId: "u", offset: 0, end: 4, totalCharacters: 4 },
    };
    const [message] = sharedMessages([
      { id: "a", role: "assistant", parts: [document, read] as UIMessage["parts"] },
    ]);
    expect(message.parts).toEqual([
      {
        type: "tool-create_document",
        toolCallId: "doc",
        state: "output-available",
        input: document.input,
        output: document.output,
      },
      read,
    ]);
  });

  it("publishes code runs and points their files at the share snapshot", () => {
    const run = {
      type: "tool-run_python",
      toolCallId: "run",
      state: "output-available",
      input: { code: "df.plot()" },
      output: {
        exitCode: 0,
        timedOut: false,
        durationMs: 5,
        stdout: "",
        stderr: "",
        files: [
          { id: "chart", url: "/api/uploads/chart", name: "chart.png", mediaType: "image/png", size: 10 },
          { id: "data", url: "/api/uploads/data", name: "data.csv", mediaType: "text/csv", size: 4 },
        ],
      },
      callProviderMetadata: { secret: true },
    };
    const replaced: string[] = [];
    const [message] = mapUploadReferences(
      sharedMessages([{ id: "a", role: "assistant", parts: [run] as UIMessage["parts"] }]),
      (id) => {
        replaced.push(id);
        return `/api/share/token/files/${id}`;
      },
    );
    expect(replaced).toEqual(["chart", "data"]);
    expect(message.parts).toEqual([
      {
        type: "tool-run_python",
        toolCallId: "run",
        state: "output-available",
        input: run.input,
        output: {
          ...run.output,
          files: [
            { ...run.output.files[0], url: "/api/share/token/files/chart" },
            { ...run.output.files[1], url: "/api/share/token/files/data" },
          ],
        },
      },
    ]);
    expect(run.output.files[0].url).toBe("/api/uploads/chart");
  });

  it("does not publish system instructions or hidden compaction checkpoints", () => {
    expect(
      sharedMessages([
        {
          id: "system",
          role: "system",
          parts: [{ type: "text", text: "private instructions" }],
        },
        {
          id: "checkpoint",
          role: "user",
          parts: [{ type: "text", text: "internal summary" }],
          metadata: { contextStatus: "manual-compacted" },
        },
      ]),
    ).toEqual([]);
  });
});
