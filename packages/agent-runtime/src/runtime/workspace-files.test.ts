import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));

import {
  AGENT_WORKSPACE_FILES_SCRIPT,
  workspaceFilesService,
} from "./workspace-files";

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function runWorkspaceFiles(
  action: "list" | "read",
  root: string,
  requestedPath: string,
): unknown {
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["-e", AGENT_WORKSPACE_FILES_SCRIPT, action, root, requestedPath],
      { encoding: "utf8" },
    ),
  ) as unknown;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("workspace-confined file service", () => {
  it("lists directories and reads typed UTF-8 text payloads", () => {
    const root = temporaryDirectory("overtchat-files-");
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src", "index.ts"), "export const ok = true;\n");
    mkdirSync(path.join(root, ".git"));

    expect(runWorkspaceFiles("list", root, ".")).toEqual({
      path: ".",
      entries: [
        { name: "src", path: "src", kind: "directory", symlink: false },
      ],
      truncated: false,
    });
    expect(runWorkspaceFiles("read", root, "src/index.ts")).toMatchObject({
      kind: "text",
      encoding: "utf-8",
      path: "src/index.ts",
      content: "export const ok = true;\n",
      size: 24,
    });
  });

  it("sorts the complete directory before applying its deterministic limit", () => {
    const root = temporaryDirectory("overtchat-files-limit-");
    mkdirSync(path.join(root, "aaa-directory"));
    for (let index = 0; index < 1_000; index += 1) {
      writeFileSync(
        path.join(root, `file-${String(index).padStart(4, "0")}`),
        "",
      );
    }
    writeFileSync(path.join(root, "zzzz-last"), "");

    const listing = runWorkspaceFiles("list", root, ".") as {
      entries: Array<{ name: string }>;
      truncated: boolean;
    };

    expect(listing.truncated).toBe(true);
    expect(listing.entries).toHaveLength(1_000);
    expect(listing.entries[0]?.name).toBe("aaa-directory");
    expect(listing.entries.some((entry) => entry.name === "file-0000")).toBe(true);
    expect(listing.entries.some((entry) => entry.name === "zzzz-last")).toBe(false);
  });

  it("marks only visible Git-ignored entries without enumerating ignored trees", () => {
    const root = temporaryDirectory("overtchat-files-ignored-");
    execFileSync("git", ["init", "--quiet", root]);
    writeFileSync(path.join(root, ".gitignore"), "*.log\ncache/\n");
    writeFileSync(path.join(root, "kept.ts"), "export {};\n");
    writeFileSync(path.join(root, "debug.log"), "ignored\n");
    writeFileSync(path.join(root, "tracked.log"), "tracked despite the pattern\n");
    execFileSync("git", ["-C", root, "add", "-f", "tracked.log"]);
    mkdirSync(path.join(root, "cache"));
    writeFileSync(path.join(root, "cache", "artifact.txt"), "ignored\n");

    const listing = runWorkspaceFiles("list", root, ".") as {
      entries: Array<{ name: string; ignored?: boolean }>;
    };

    expect(listing.entries.find((entry) => entry.name === "debug.log")).toMatchObject({
      ignored: true,
    });
    expect(listing.entries.find((entry) => entry.name === "cache")).toMatchObject({
      ignored: true,
    });
    expect(listing.entries.find((entry) => entry.name === "kept.ts")?.ignored).toBeUndefined();
    expect(listing.entries.find((entry) => entry.name === "tracked.log")?.ignored).toBeUndefined();
  });

  it("rejects traversal, escaping symlinks, binary data, invalid UTF-8, and large files", () => {
    const root = temporaryDirectory("overtchat-files-");
    const outside = temporaryDirectory("overtchat-outside-");
    writeFileSync(path.join(outside, "secret.txt"), "secret");
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape"));
    writeFileSync(path.join(root, "binary"), Buffer.from([0, 1, 2]));
    writeFileSync(path.join(root, "invalid-utf8"), Buffer.from([0xc3, 0x28]));
    writeFileSync(path.join(root, "large"), Buffer.alloc(512 * 1024 + 1, 65));

    for (const requestedPath of [
      "../secret.txt",
      "escape",
      "binary",
      "invalid-utf8",
      "large",
    ]) {
      const result = spawnSync(
        process.execPath,
        ["-e", AGENT_WORKSPACE_FILES_SCRIPT, "read", root, requestedPath],
        { encoding: "utf8" },
      );
      expect(result.status, requestedPath).toBe(1);
    }
  });

  it("uses one typed service boundary for local and SSH host execution", async () => {
    mocks.executeOnHost
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          path: ".",
          entries: [
            { name: "src", path: "src", kind: "directory", symlink: false },
          ],
          truncated: false,
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          kind: "text",
          encoding: "utf-8",
          path: "src/index.ts",
          content: "export {};",
          size: 10,
          modifiedAt: 100,
        }),
        stderr: "",
      });

    await expect(
      workspaceFilesService.listDirectory(
        { transport: "ssh", alias: "workstation" },
        "/srv/project",
        "src",
      ),
    ).resolves.toMatchObject({ path: ".", truncated: false });
    await expect(
      workspaceFilesService.readFile(
        { transport: "local" },
        "/srv/project",
        "src/index.ts",
      ),
    ).resolves.toMatchObject({
      kind: "text",
      encoding: "utf-8",
      path: "src/index.ts",
      content: "export {};",
    });
    expect(mocks.executeOnHost).toHaveBeenNthCalledWith(
      1,
      { transport: "ssh", alias: "workstation" },
      expect.objectContaining({
        command: "node",
        args: expect.arrayContaining(["list", "/srv/project", "src"]),
      }),
    );
    expect(mocks.executeOnHost).toHaveBeenNthCalledWith(
      2,
      { transport: "local" },
      expect.objectContaining({
        command: "node",
        args: expect.arrayContaining([
          "read",
          "/srv/project",
          "src/index.ts",
        ]),
      }),
    );
  });

  it("rejects malformed host responses at the service boundary", async () => {
    mocks.executeOnHost.mockResolvedValue({
      stdout: JSON.stringify({
        path: "README.md",
        content: "missing kind and encoding",
        size: 25,
        modifiedAt: 100,
      }),
      stderr: "",
    });

    await expect(
      workspaceFilesService.readFile(
        { transport: "local" },
        "/srv/project",
        "README.md",
      ),
    ).rejects.toThrow("invalid workspace file");
  });
});
