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
  action: "list" | "read" | "diff",
  root: string,
  requestedPath: string,
  option?: string,
): unknown {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "-e",
        AGENT_WORKSPACE_FILES_SCRIPT,
        action,
        root,
        requestedPath,
        ...(option ? [option] : []),
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  ) as unknown;
}

function failWorkspaceFiles(
  action: "read" | "diff",
  root: string,
  requestedPath: string,
  option?: string,
): string {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      AGENT_WORKSPACE_FILES_SCRIPT,
      action,
      root,
      requestedPath,
      ...(option ? [option] : []),
    ],
    { encoding: "utf8" },
  );
  expect(result.status, requestedPath).toBe(1);
  return result.stderr;
}

function git(root: string, ...args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: root, stdio: "ignore" },
  );
}

function repository(): string {
  const root = temporaryDirectory("overtchat-diff-");
  git(root, "init", "--quiet", "--initial-branch=main");
  return root;
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

  it("reads images as base64 only when the request asks for them", () => {
    const root = temporaryDirectory("overtchat-files-");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    writeFileSync(path.join(root, "Shot.PNG"), png);
    writeFileSync(path.join(root, "large.jpg"), Buffer.alloc(5 * 1024 * 1024 + 1));
    writeFileSync(path.join(root, "notes.txt"), "plain\n");

    expect(runWorkspaceFiles("read", root, "Shot.PNG", "images")).toMatchObject({
      kind: "image",
      encoding: "base64",
      mediaType: "image/png",
      path: "Shot.PNG",
      content: png.toString("base64"),
      size: png.length,
    });
    expect(runWorkspaceFiles("read", root, "notes.txt", "images")).toMatchObject({
      kind: "text",
      content: "plain\n",
    });
    expect(failWorkspaceFiles("read", root, "Shot.PNG")).toContain(
      "Binary files cannot be previewed.",
    );
    expect(failWorkspaceFiles("read", root, "large.jpg", "images")).toContain(
      "Image is too large to preview (maximum 5 MB).",
    );
  });

  it("diffs one file's uncommitted changes against the last commit", () => {
    const root = repository();
    writeFileSync(path.join(root, "kept.txt"), "one\ntwo\n");
    writeFileSync(path.join(root, "gone.txt"), "bye\n");
    writeFileSync(path.join(root, "old name.txt"), "a\nb\nc\nd\n");
    writeFileSync(path.join(root, "[literal].txt"), "x\n");
    writeFileSync(path.join(root, "image.bin"), Buffer.from([0, 1, 2]));
    git(root, "add", "-A");
    git(root, "commit", "--quiet", "-m", "initial");

    writeFileSync(path.join(root, "kept.txt"), "one\nthree\n");
    rmSync(path.join(root, "gone.txt"));
    git(root, "mv", "old name.txt", "new name.txt");
    writeFileSync(path.join(root, "new name.txt"), "a\nb\nc\nD\n");
    writeFileSync(path.join(root, "image.bin"), Buffer.from([0, 9, 9]));
    writeFileSync(path.join(root, "fresh.txt"), "hello\n");
    writeFileSync(path.join(root, "staged.txt"), "staged\n");
    git(root, "add", "staged.txt", "new name.txt");

    const kept = runWorkspaceFiles("diff", root, "kept.txt") as { patch: string };
    expect(kept).toMatchObject({ path: "kept.txt", truncated: false, binary: false });
    expect(kept.patch).toContain("@@ -1,2 +1,2 @@");
    expect(kept.patch).toContain("-two\n+three\n");

    expect(
      (runWorkspaceFiles("diff", root, "gone.txt") as { patch: string }).patch,
    ).toContain("deleted file mode");
    expect(
      (runWorkspaceFiles("diff", root, "fresh.txt") as { patch: string }).patch,
    ).toMatch(/new file mode[\s\S]*\+hello\n/u);
    expect(
      (runWorkspaceFiles("diff", root, "staged.txt") as { patch: string }).patch,
    ).toContain("+staged\n");

    const renamed = runWorkspaceFiles("diff", root, "new name.txt", "old name.txt") as {
      patch: string;
    };
    expect(renamed.patch).toContain("rename from old name.txt");
    expect(renamed.patch).toContain("-d\n+D\n");
    expect(renamed.patch).not.toContain("+a\n");

    expect(runWorkspaceFiles("diff", root, "image.bin")).toEqual({
      path: "image.bin",
      patch: "",
      truncated: false,
      binary: true,
    });
    // An unchanged file has no diff, and its name is never a pattern.
    expect(runWorkspaceFiles("diff", root, "[literal].txt")).toEqual({
      path: "[literal].txt",
      patch: "",
      truncated: false,
      binary: false,
    });
  });

  it("diffs inside a workspace below the repository root and before the first commit", () => {
    const root = repository();
    mkdirSync(path.join(root, "packages", "app"), { recursive: true });
    writeFileSync(path.join(root, "packages", "app", "index.ts"), "export {};\n");
    const workspace = path.join(root, "packages", "app");

    expect(
      (runWorkspaceFiles("diff", workspace, "index.ts") as { patch: string }).patch,
    ).toContain("+export {};\n");
    git(root, "add", "-A");
    expect(
      (runWorkspaceFiles("diff", workspace, "index.ts") as { patch: string }).patch,
    ).toContain("+export {};\n");

    git(root, "commit", "--quiet", "-m", "initial");
    writeFileSync(path.join(workspace, "index.ts"), "export const a = 1;\n");
    const changed = runWorkspaceFiles("diff", workspace, "index.ts") as {
      path: string;
      patch: string;
    };
    expect(changed.path).toBe("index.ts");
    expect(changed.patch).toContain("+++ b/index.ts");
    expect(changed.patch).not.toContain("packages/app");
  });

  it("cuts an oversized diff at a line and refuses paths outside the workspace", () => {
    const root = repository();
    const outside = temporaryDirectory("overtchat-outside-");
    writeFileSync(path.join(outside, "secret.txt"), "secret\n");
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape"));
    writeFileSync(
      path.join(root, "huge.txt"),
      Array.from({ length: 80_000 }, (_, index) => `line ${index}`).join("\n") + "\n",
    );

    const huge = runWorkspaceFiles("diff", root, "huge.txt") as {
      patch: string;
      truncated: boolean;
    };
    expect(huge.truncated).toBe(true);
    expect(huge.patch.length).toBeGreaterThan(100_000);
    expect(huge.patch.length).toBeLessThanOrEqual(512 * 1024);
    expect(huge.patch.endsWith("\n")).toBe(true);

    expect(runWorkspaceFiles("diff", root, "escape")).toMatchObject({ patch: "" });
    expect(failWorkspaceFiles("diff", root, "../secret.txt")).toContain(
      "Path is outside the workspace.",
    );
    expect(failWorkspaceFiles("diff", root, "huge.txt", "../secret.txt")).toContain(
      "Path is outside the workspace.",
    );
    expect(
      failWorkspaceFiles("diff", temporaryDirectory("overtchat-plain-"), "a.txt"),
    ).toContain("This workspace is not a Git repository.");
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

  it("asks the host for images and diffs through the same boundary", async () => {
    const image = {
      kind: "image",
      encoding: "base64",
      mediaType: "image/png",
      path: "shot.png",
      content: "iVBORw==",
      size: 4,
      modifiedAt: 100,
    };
    mocks.executeOnHost
      .mockResolvedValueOnce({ stdout: JSON.stringify(image), stderr: "" })
      .mockResolvedValueOnce({ stdout: JSON.stringify(image), stderr: "" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          path: "src/index.ts",
          patch: "@@ -1 +1 @@\n-a\n+b\n",
          truncated: false,
          binary: false,
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ patch: 1 }), stderr: "" });
    const target = { transport: "local" } as const;

    await expect(
      workspaceFilesService.readFile(target, "/srv/project", "shot.png", {
        images: true,
      }),
    ).resolves.toEqual(image);
    // An image nobody asked for is not a valid answer.
    await expect(
      workspaceFilesService.readFile(target, "/srv/project", "shot.png"),
    ).rejects.toThrow("The remote machine returned an invalid workspace file.");
    await expect(
      workspaceFilesService.readFileDiff(
        target,
        "/srv/project",
        "src/index.ts",
        "src/old.ts",
      ),
    ).resolves.toMatchObject({ path: "src/index.ts", binary: false });
    await expect(
      workspaceFilesService.readFileDiff(target, "/srv/project", "src/index.ts"),
    ).rejects.toThrow(
      "The remote machine returned an invalid workspace file diff.",
    );

    expect(mocks.executeOnHost).toHaveBeenNthCalledWith(
      1,
      target,
      expect.objectContaining({
        args: expect.arrayContaining(["read", "/srv/project", "shot.png", "images"]),
      }),
      { maxCaptureBytes: expect.any(Number) },
    );
    expect(mocks.executeOnHost.mock.calls[0][2].maxCaptureBytes).toBeGreaterThan(
      (5 * 1024 * 1024 * 4) / 3,
    );
    expect(mocks.executeOnHost.mock.calls[1][1].args).not.toContain("images");
    expect(mocks.executeOnHost.mock.calls[2][1].args.slice(-4)).toEqual([
      "diff",
      "/srv/project",
      "src/index.ts",
      "src/old.ts",
    ]);
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
