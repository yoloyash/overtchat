import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  insertValues: vi.fn(),
  mkdirSync: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  removeFile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => ({
  default: { mkdirSync: mocks.mkdirSync },
}));
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    rm: mocks.removeFile,
  },
}));
vi.mock("@/lib/db/client", () => ({
  db: { insert: mocks.insert },
}));
vi.mock("@/lib/db/schema", () => ({
  messages: {},
  uploads: {},
}));

import { storeCodeArtifacts, storeFetchedImage } from "./uploads";

describe("fetched image persistence boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("persists bytes only after their signature matches the media type", async () => {
    const data = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    await expect(
      storeFetchedImage({
        userId: "user-id",
        filename: "image.png",
        mediaType: "image/png",
        data,
      }),
    ).resolves.toMatchObject({ uploadUrl: expect.stringMatching(/^\/api\/uploads\//) });

    expect(mocks.writeFile).toHaveBeenCalledOnce();
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-id",
        mediaType: "image/png",
        category: "image",
        size: data.byteLength,
      }),
    );
  });

  it("rejects mismatched bytes before touching disk or SQLite", async () => {
    await expect(
      storeFetchedImage({
        userId: "user-id",
        filename: "image.png",
        mediaType: "image/png",
        data: new TextEncoder().encode("not an image"),
      }),
    ).rejects.toThrow("do not match image/png");

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe("code artifact persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.removeFile.mockResolvedValue(undefined);
  });

  it("stores a generated batch and returns authenticated references", async () => {
    const artifacts = await storeCodeArtifacts([
      {
        userId: "user-id",
        filename: "../report.csv",
        mediaType: "text/csv",
        data: new TextEncoder().encode("value\n42\n"),
        image: false,
      },
    ]);

    expect(artifacts).toEqual([
      expect.objectContaining({
        kind: "file",
        name: ".._report.csv",
        mediaType: "text/csv",
        url: expect.stringMatching(/^\/api\/uploads\//),
      }),
    ]);
    expect(mocks.insertValues).toHaveBeenCalledWith([
      expect.objectContaining({ category: "artifact", filename: ".._report.csv" }),
    ]);
  });

  it("removes every batch file when SQLite persistence fails", async () => {
    mocks.insertValues.mockRejectedValue(new Error("database unavailable"));

    await expect(
      storeCodeArtifacts([
        {
          userId: "user-id",
          filename: "one.txt",
          mediaType: "text/plain",
          data: new TextEncoder().encode("one"),
          image: false,
        },
        {
          userId: "user-id",
          filename: "two.txt",
          mediaType: "text/plain",
          data: new TextEncoder().encode("two"),
          image: false,
        },
      ]),
    ).rejects.toThrow("database unavailable");

    expect(mocks.removeFile).toHaveBeenCalledTimes(2);
  });
});
