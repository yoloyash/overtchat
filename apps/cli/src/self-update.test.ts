import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWindowsCliBackups, updateCliIfNeeded, type ReleaseManifest } from "./release.js";
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

it("retains the renamed Windows image until a later launch and rejects bad updates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-win-update-"));
  directories.push(directory);
  const executable = path.join(directory, "overtchat.exe");
  await writeFile(executable, "previous binary");
  vi.spyOn(process, "execPath", "get").mockReturnValue(executable);
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  vi.spyOn(process, "arch", "get").mockReturnValue("x64");
  const binary = "new Windows binary";
  const checksum = createHash("sha256").update(binary).digest("hex");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
    url.endsWith("overtchat-checksums.txt") ? `${checksum}  overtchat-windows-amd64.exe\n` : binary,
  )));
  vi.mocked(runCommand).mockResolvedValue({ exitCode: 1, stdout: "", stderr: "broken candidate" });
  await expect(updateCliIfNeeded({ cliVersion: "99.0.0" } as ReleaseManifest)).rejects.toThrow("startup check");
  expect(await readFile(executable, "utf8")).toBe("previous binary");
  vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: "99.0.0", stderr: "" });
  await expect(updateCliIfNeeded({ cliVersion: "99.0.0" } as ReleaseManifest)).resolves.toBe(executable);
  expect(await readFile(executable, "utf8")).toBe(binary);
  const backup = (await readdir(directory)).find((name) => name.startsWith("overtchat.exe.previous-"));
  expect(backup).toBeDefined();
  expect(await readFile(path.join(directory, backup!), "utf8")).toBe("previous binary");
  const unrelated = path.join(directory, "overtchat.exe.previous-do-not-delete");
  await writeFile(unrelated, "unrelated");
  await cleanupWindowsCliBackups();
  expect(await readdir(directory)).toEqual(expect.arrayContaining(["overtchat.exe", path.basename(unrelated)]));
  await expect(readFile(path.join(directory, backup!))).rejects.toMatchObject({ code: "ENOENT" });
});
