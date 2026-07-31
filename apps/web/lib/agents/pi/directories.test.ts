import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listAgentDirectories } from "./probe";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const temporaryPath of temporaryPaths.splice(0)) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
  }
});

describe("agent directory browsing", () => {
  it("lists directories on the target and resolves canonical paths", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-dirs-"));
    temporaryPaths.push(root);
    fs.mkdirSync(path.join(root, "zeta"));
    fs.mkdirSync(path.join(root, "alpha"));
    fs.writeFileSync(path.join(root, "ignore.txt"), "not a directory");
    fs.symlinkSync(path.join(root, "alpha"), path.join(root, "linked"));

    const listing = await listAgentDirectories(
      { transport: "local" },
      root,
    );

    expect(listing.path).toBe(fs.realpathSync(root));
    expect(listing.parent).toBe(path.dirname(fs.realpathSync(root)));
    expect(listing.directories.map(({ name }) => name)).toEqual([
      "alpha",
      "linked",
      "zeta",
    ]);
  });

  it("fails when the selected path is not a directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-dirs-"));
    temporaryPaths.push(root);
    const file = path.join(root, "file.txt");
    fs.writeFileSync(file, "hello");

    await expect(
      listAgentDirectories({ transport: "local" }, file),
    ).rejects.toThrow("Path is not a directory");
  });
});
