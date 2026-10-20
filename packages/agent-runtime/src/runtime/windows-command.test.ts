import path from "node:path";
import { describe, expect, it } from "vitest";
import { WINDOWS_COMMAND_SCRIPT } from "./windows-command";

function resolver(files: string[]) {
  const existing = new Set(files.map((file) => file.toLowerCase()));
  const require = (name: string) =>
    name === "node:path"
      ? path.win32
      : name === "node:fs"
        ? {
            statSync(file: string) {
              if (!existing.has(file.toLowerCase())) throw Error("ENOENT");
              return { isFile: () => true };
            },
          }
        : {};
  return new Function(
    "require",
    WINDOWS_COMMAND_SCRIPT + ";return resolveCommand;",
  )(require) as (command: string, env: Record<string, string>) => string;
}

describe("Windows executable resolution", () => {
  it("chooses the Windows npm shim when the Unix shim also exists", () => {
    const resolve = resolver([
      "C:\\npm\\codex",
      "C:\\npm\\codex.cmd",
      "C:\\npm\\codex.ps1",
    ]);
    expect(
      resolve("codex", { Path: "C:\\npm", Pathext: ".COM;.EXE;.BAT;.CMD" }),
    ).toBe("C:\\npm\\codex.CMD");
  });
  it("preserves PATH directory order and PATHEXT precedence", () => {
    const resolve = resolver([
      "C:\\first\\agent.cmd",
      "C:\\second\\agent.exe",
      "C:\\first\\agent.exe",
    ]);
    expect(
      resolve("agent", {
        PATH: '"C:\\first";C:\\second',
        PATHEXT: " EXE ; CMD ",
      }),
    ).toBe("C:\\first\\agent.EXE");
    expect(
      resolve("agent", { PATH: "C:\\first;C:\\second", PATHEXT: ".CMD;.EXE" }),
    ).toBe("C:\\first\\agent.CMD");
  });
  it("resolves explicit paths without consulting PATH", () => {
    const resolve = resolver(["C:\\tools\\agent.cmd"]);
    expect(resolve("C:\\tools\\agent.cmd", { PATH: "" })).toBe(
      "C:\\tools\\agent.cmd",
    );
    expect(resolve("C:\\tools\\agent", { PATH: "" })).toBe(
      "C:\\tools\\agent.CMD",
    );
  });
  it("does not try to spawn a POSIX shim as a native executable", () => {
    expect(() =>
      resolver(["C:\\npm\\agent"])("agent", { PATH: "C:\\npm" }),
    ).toThrow("Executable not found");
  });
});
