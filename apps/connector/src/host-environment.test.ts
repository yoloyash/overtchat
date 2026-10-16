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
