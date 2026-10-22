import { afterEach, expect, it, vi } from "vitest";
import { connectorInvocation } from "./service.js";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("keeps installed services on the stable launcher across runtime upgrades", () => {
  vi.stubEnv("OVERTCHAT_CONNECTOR_LAUNCHER", "/home/test/.local/bin/overtchat-connector");
  expect(connectorInvocation()).toEqual(["/home/test/.local/bin/overtchat-connector", "run"]);
});

it("keeps the Node entry point for source development", () => {
  vi.stubEnv("OVERTCHAT_CONNECTOR_LAUNCHER", undefined);
  const previous = process.argv;
  try {
    process.argv = [process.execPath, "/tmp/connector.mjs"];
    expect(connectorInvocation()).toEqual([process.execPath, "/tmp/connector.mjs", "run"]);
  } finally { process.argv = previous; }
});
