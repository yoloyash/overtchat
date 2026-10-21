import { describe, expect, it, vi } from "vitest";
import { HostEnvironments } from "./host-environment.js";

const target = { transport: "ssh", alias: "pc" } as const;
describe("SSH environment detection", () => {
  it("uses POSIX hosts without a Windows probe", async () => {
    const run = vi.fn().mockResolvedValue("Linux\n");
    const environments = new HostEnvironments(run);
    expect(await environments.inspect(target)).toEqual({ platform: "posix" });
    expect(await environments.inspect(target)).toEqual({ platform: "posix" });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("falls back from shell rejection, shares concurrent probes, and handles missing Node", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("uname is not recognized"), { code: 1 }),
      )
      .mockResolvedValue('{"platform":"win32","node":null}\r\n');
    const environments = new HostEnvironments(run);
    expect(
      await Promise.all([
        environments.inspect(target),
        environments.inspect(target),
      ]),
    ).toEqual([{ platform: "win32" }, { platform: "win32" }]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][1]).toMatch(
      /^powershell.exe .* -EncodedCommand [A-Za-z0-9+/=]+$/u,
    );
  });
  it("does not turn SSH authentication failures into platform errors or cache them", async () => {
    const error = Object.assign(new Error("Permission denied (publickey)"), {
      code: 255,
    });
    const run = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("Darwin\n");
    const environments = new HostEnvironments(run);
    await expect(environments.inspect(target)).rejects.toBe(error);
    expect(await environments.inspect(target)).toEqual({ platform: "posix" });
    expect(run).toHaveBeenCalledTimes(2);
  });
});

it("discovers real Node for a packaged Windows connector instead of executing itself", async () => {
  const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const previous = process.versions.bun;
  process.versions.bun = "1.3.14";
  try {
    const run = vi.fn().mockResolvedValue(JSON.stringify({ platform: "win32", node: "C:\\Program Files\\nodejs\\node.exe", version: "v22.19.0" }));
    const environment = await new HostEnvironments(run).inspect({ transport: "local" });
    expect(environment.nodeVersion).toBe("v22.19.0");
    const script = Buffer.from(run.mock.calls[0]![1].split(" ").at(-1)!, "base64").toString("utf16le");
    expect(script).toContain("Get-Command node.exe");
    expect(script).not.toContain(process.execPath);
  } finally {
    if (previous === undefined) delete process.versions.bun;
    else process.versions.bun = previous;
    platform.mockRestore();
  }
});
