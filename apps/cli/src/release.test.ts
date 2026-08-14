import { describe, expect, it } from "vitest";
import { compareVersions, parseReleaseManifest } from "./release.js";

describe("release manifest", () => {
  it("accepts one coordinated set of component versions", () => {
    expect(
      parseReleaseManifest({
        format: 1,
        cliVersion: "1.2.3",
        appVersion: "4.5.6",
        connectorVersion: "7.8.9",
        sttVersion: "0.1.0",
      }),
    ).toEqual({
      format: 1,
      cliVersion: "1.2.3",
      appVersion: "4.5.6",
      connectorVersion: "7.8.9",
      sttVersion: "0.1.0",
    });
  });

  it("rejects malformed or unpinned versions", () => {
    expect(() =>
      parseReleaseManifest({
        format: 1,
        cliVersion: "latest",
        appVersion: "4.5.6",
        connectorVersion: "7.8.9",
        sttVersion: "0.1.0",
      }),
    ).toThrow("invalid CLI version");
  });

  it("orders stable component versions without downgrading", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("0.4.0", "1.0.0")).toBeLessThan(0);
  });
});
