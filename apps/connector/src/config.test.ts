import { describe, expect, it } from "vitest";
import {
  connectorLockPath,
  connectorStatePath,
  connectorTimelinePath,
  normalizeServerUrl,
} from "./config.js";

describe("connector server URLs", () => {
  it("accepts local HTTP and normalizes optional URL parts", () => {
    expect(
      normalizeServerUrl("http://127.0.0.1:9000/path?ignored=yes#ignored"),
    ).toBe("http://127.0.0.1:9000/path");
    expect(normalizeServerUrl("http://localhost:4718/")).toBe(
      "http://localhost:4718",
    );
  });

  it("requires HTTPS for non-local servers", () => {
    expect(() => normalizeServerUrl("http://192.168.1.10:4718")).toThrow(
      "Non-local OvertChat URLs must use HTTPS.",
    );
    expect(normalizeServerUrl("https://chat.example.com/")).toBe(
      "https://chat.example.com",
    );
  });

  it("rejects unsupported URL protocols", () => {
    expect(() => normalizeServerUrl("file:///tmp/overtchat")).toThrow(
      "OvertChat URL must use HTTP or HTTPS.",
    );
  });

  it("keeps each paired connector's state separate", () => {
    expect(connectorStatePath("connector-1")).toMatch(
      /connector-connector-1\.state\.json$/u,
    );
    expect(connectorTimelinePath("connector-1")).toMatch(
      /connector-connector-1\.timelines$/u,
    );
    expect(connectorLockPath("connector-1")).toMatch(
      /connector-connector-1\.lock$/u,
    );
  });
});
