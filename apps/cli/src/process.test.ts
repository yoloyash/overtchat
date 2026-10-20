import { expect, it } from "vitest";
import { requireSuccessful, runCommand } from "./process.js";

it("preserves stdin when relaunching an interactive CLI", async () => {
  const module = new URL("./process.ts", import.meta.url).href;
  const script = `import { requireSuccessful } from ${JSON.stringify(module)};
    await requireSuccessful(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { inherit: true });`;
  const result = await requireSuccessful(process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { input: "interactive input\n", timeoutMs: 5_000 });
  expect(result.stdout).toBe("interactive input\n");
});

it("terminates a stuck command even if it ignores SIGTERM", async () => {
  const result = await runCommand(process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { timeoutMs: 200 });
  expect(result).toMatchObject({ exitCode: 1, timedOut: true, signal: "SIGKILL" });
});

it("includes the termination signal in executable failure messages", async () => {
  await expect(requireSuccessful(process.execPath,
    ["-e", "process.kill(process.pid, 'SIGTERM')"], { timeoutMs: 5_000 }))
    .rejects.toThrow("was terminated by SIGTERM");
});
