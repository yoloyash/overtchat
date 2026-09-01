import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));

import {
  AGENT_WORKSPACE_FILES_SCRIPT,
  listAgentDirectories,
  listAgentWorkspaceDirectory,
  readAgentWorkspaceFile,
} from "./filesystem";

const connectorId = "11111111-1111-4111-8111-111111111111";

describe("agent directory browsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the connector's canonical directory listing", async () => {
    mocks.executeOnHost.mockResolvedValue({
      stdout: JSON.stringify({
        path: "/srv/project",
        parent: "/srv",
        directories: [
          { name: "alpha", path: "/srv/project/alpha" },
          { name: "zeta", path: "/srv/project/zeta" },
        ],
      }),
      stderr: "",
    });
    const listing = await listAgentDirectories(
      { transport: "local" },
      "/srv/project",
    );

    expect(listing).toEqual({
      path: "/srv/project",
      parent: "/srv",
      directories: [
        { name: "alpha", path: "/srv/project/alpha" },
        { name: "zeta", path: "/srv/project/zeta" },
      ],
    });
    expect(mocks.executeOnHost).toHaveBeenCalledWith(
      { transport: "local" },
      expect.objectContaining({
        command: "node",
        args: expect.arrayContaining(["/srv/project"]),
      }),
    );
  });

  it("rejects malformed connector output", async () => {
    mocks.executeOnHost.mockResolvedValue({
      stdout: JSON.stringify({ path: "/srv/project", directories: "invalid" }),
      stderr: "",
    });

    await expect(
      listAgentDirectories(
        { transport: "local" },
        "/srv/project",
      ),
    ).rejects.toThrow("invalid directory list");
  });
});

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

describe("workspace-confined file browsing", () => {
  it("lists directories and reads UTF-8 files relative to the workspace", () => {
    const root = mkdtempSync(path.join(tmpdir(), "overtchat-files-"));
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
      path: "src/index.ts",
      content: "export const ok = true;\n",
      size: 24,
    });
  });

  it("rejects traversal, escaping symlinks, binary files, and oversized files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "overtchat-files-"));
    const outside = mkdtempSync(path.join(tmpdir(), "overtchat-outside-"));
    writeFileSync(path.join(outside, "secret.txt"), "secret");
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape"));
    writeFileSync(path.join(root, "binary"), Buffer.from([0, 1, 2]));
    writeFileSync(path.join(root, "large"), Buffer.alloc(512 * 1024 + 1, 65));

    for (const requestedPath of ["../secret.txt", "escape", "binary", "large"]) {
      const result = spawnSync(
        process.execPath,
        ["-e", AGENT_WORKSPACE_FILES_SCRIPT, "read", root, requestedPath],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
    }
  });

  it("normalizes and validates connector responses", async () => {
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
          path: "src/index.ts",
          content: "export {};",
          size: 10,
          modifiedAt: 100,
        }),
        stderr: "",
      });

    await expect(
      listAgentWorkspaceDirectory(
        { transport: "ssh", alias: "workstation" },
        "/srv/project",
        "src",
      ),
    ).resolves.toMatchObject({ path: ".", truncated: false });
    await expect(
      readAgentWorkspaceFile(
        { transport: "ssh", alias: "workstation" },
        "/srv/project",
        "src/index.ts",
      ),
    ).resolves.toMatchObject({ path: "src/index.ts", content: "export {};" });
  });
});
