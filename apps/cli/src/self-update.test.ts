import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { recoverInterruptedCliUpdate, updateCliIfNeeded, type ReleaseManifest } from "./release.js";
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

it.runIf(process.platform !== "win32").each(["overtchat", "overtchat-darwin-arm64"])(
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

it("commits a verified Windows replacement and rejects bad updates", async () => {
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
  // In this file-level test the old executable is not mapped by Windows;
  // native smoke coverage separately verifies deferred cleanup of a live image.
  await expect(readFile(`${executable}.previous`)).rejects.toMatchObject({ code: "ENOENT" });
  const unrelated = path.join(directory, "overtchat.exe.previous-do-not-delete");
  await writeFile(unrelated, "unrelated");
  await recoverInterruptedCliUpdate();
  expect(await readdir(directory)).toEqual(expect.arrayContaining(["overtchat.exe", path.basename(unrelated)]));

});

it("bootstraps an interrupted Windows update whose CLI entry point is missing", async () => {
  const { BinaryUpdate } = await import("./binary-update.js");
  const { installDownloadedCli } = await import("./release.js");
  const { rename } = await import("node:fs/promises");
  const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-bootstrap-recovery-"));
  directories.push(directory);
  const executable = path.join(directory, "overtchat.exe");
  const candidate = path.join(directory, "downloaded.exe");
  await writeFile(executable, "old CLI");
  await writeFile(candidate, "verified candidate");
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  vi.spyOn(process, "execPath", "get").mockReturnValue(candidate);
  vi.stubEnv("OVERTCHAT_BIN_DIR", directory);
  try {
    const interrupted = new BinaryUpdate(executable);
    await interrupted.prepare(candidate);
    await rename(executable, interrupted.backup);
    vi.mocked(runCommand).mockImplementation(async () => {
      expect(await readFile(executable, "utf8")).toBe("old CLI");
      return { exitCode: 0, stdout: "0.1.0", stderr: "" };
    });
    await installDownloadedCli();
    expect(await readFile(executable, "utf8")).toBe("verified candidate");
    await expect(readFile(interrupted.journal)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { vi.unstubAllEnvs(); }
});
