import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { updateCliIfNeeded, type ReleaseManifest } from "./release.js";
import { runCommand } from "./process.js";
vi.mock("./process.js", () => ({ runCommand: vi.fn() }));
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it.each(["overtchat", "overtchat-darwin-arm64"])(
  "updates the Mac executable %s using a verified Darwin asset",
  async (name) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "overtchat-self-update-"),
    );
    directories.push(directory);
    const executable = path.join(directory, name);
    await writeFile(executable, "previous binary", { mode: 0o755 });
    vi.spyOn(process, "execPath", "get").mockReturnValue(executable);
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.spyOn(process, "arch", "get").mockReturnValue("arm64");
    const binary = "new binary";
    const checksum = createHash("sha256").update(binary).digest("hex");
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          url.endsWith("overtchat-checksums.txt")
            ? `${checksum}  overtchat-darwin-arm64\n`
            : binary,
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    vi.mocked(runCommand).mockResolvedValue({
      exitCode: 0,
      stdout: "99.0.0",
      stderr: "",
    });
    await expect(
      updateCliIfNeeded({ cliVersion: "99.0.0" } as ReleaseManifest),
    ).resolves.toBe(executable);
    expect(fetcher.mock.calls[0][0]).toMatch(
      /\/cli-v99\.0\.0\/overtchat-darwin-arm64$/u,
    );
    expect(await readFile(executable, "utf8")).toBe(binary);
  },
);
