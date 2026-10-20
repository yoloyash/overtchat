import { describe, expect, it } from "vitest";
import { isAbsoluteAgentPath } from "./paths";
import { createAgentWorkspaceSchema } from "./agents";

describe("execution host paths", () => {
  it.each([
    "/home/user/project",
    "/",
    "C:\\Users\\Name With Spaces\\雪",
    "D:/work",
    "C:\\",
    "\\\\server\\share\\project",
    "//server/share/project",
    "//server.example.com/share/project",
  ])("accepts %s independently of the server OS", (path) => {
    expect(isAbsoluteAgentPath(path)).toBe(true);
    expect(
      createAgentWorkspaceSchema.safeParse({
        target: { connectorId: "host", transport: "ssh", sshAlias: "windows" },
        path,
      }).success,
    ).toBe(true);
  });
  it.each([
    "",
    "relative",
    "C:project",
    "\\project",
    "\\\\server",
    "\\\\.\\pipe\\name",
    "\\\\?\\GLOBALROOT",
    "/a\0b",
    "C:\\a\nb",
  ])("rejects incomplete or special path %s", (path) => {
    expect(isAbsoluteAgentPath(path)).toBe(false);
  });
});
