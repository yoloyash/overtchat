import { describe, expect, it } from "vitest";
import {
  applyReleaseManifest,
  compareVersions,
  parseReleaseManifest,
} from "./release.js";
import type { InstallationConfig } from "./types.js";

const releaseImages = {
  redisImage: `docker.io/library/redis@sha256:${"a".repeat(64)}`,
  searxngImage: `docker.io/searxng/searxng@sha256:${"b".repeat(64)}`,
  kokoroImage: `ghcr.io/remsky/kokoro-fastapi-cpu@sha256:${"c".repeat(64)}`,
};

function config(
  overrides: Partial<InstallationConfig> = {},
): InstallationConfig {
  return {
    format: 1,
    appVersion: "1.0.0",
    appImage: "ghcr.io/yoloyash/overtchat-app:1.0.0",
    connectorVersion: "2.0.0",
    sttVersion: "3.0.0",
    ...releaseImages,
    appPort: 4718,
    bindAddress: "0.0.0.0",
    publicUrl: "http://localhost:4718",
    extraTrustedOrigins: [],
    connectorServerUrl: "http://127.0.0.1:4718",
    composeProject: "overtchat",
    dataMountType: "volume",
    dataVolume: "overtchat-data",
    search: { provider: "bundled", bundledInstalled: true },
    tts: { provider: "bundled", bundledInstalled: true },
    stt: { provider: "disabled", bundledInstalled: false },
    agents: { installed: false },
    ...overrides,
  };
}

describe("release manifest", () => {
  it("accepts one coordinated set of component versions", () => {
    expect(
      parseReleaseManifest({
        format: 1,
        cliVersion: "1.2.3",
        appVersion: "4.5.6",
        connectorVersion: "7.8.9",
        sttVersion: "0.1.0",
        ...releaseImages,
      }),
    ).toEqual({
      format: 1,
      cliVersion: "1.2.3",
      appVersion: "4.5.6",
      connectorVersion: "7.8.9",
      sttVersion: "0.1.0",
      ...releaseImages,
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
        ...releaseImages,
      }),
    ).toThrow("invalid CLI version");
  });

  it("orders stable component versions without downgrading", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("0.4.0", "1.0.0")).toBeLessThan(0);
  });

  it("applies independently newer release components", () => {
    expect(
      applyReleaseManifest(config(), {
        format: 1,
        cliVersion: "9.0.0",
        appVersion: "1.1.0",
        connectorVersion: "1.9.0",
        sttVersion: "3.1.0",
        ...releaseImages,
      }),
    ).toMatchObject({
      appVersion: "1.1.0",
      appImage: "ghcr.io/yoloyash/overtchat-app:1.1.0",
      connectorVersion: "2.0.0",
      sttVersion: "3.1.0",
      ...releaseImages,
    });
  });

  it("preserves the development image while resolving versions", () => {
    expect(
      applyReleaseManifest(config({ appImage: "overtchat-app:setup-dev" }), {
        format: 1,
        cliVersion: "1.0.0",
        appVersion: "1.1.0",
        connectorVersion: "2.0.0",
        sttVersion: "3.0.0",
        ...releaseImages,
      }).appImage,
    ).toBe("overtchat-app:setup-dev");
  });

  it("rejects mutable or unexpected sidecar image references", () => {
    expect(() =>
      parseReleaseManifest({
        format: 1,
        cliVersion: "1.2.3",
        appVersion: "4.5.6",
        connectorVersion: "7.8.9",
        sttVersion: "0.1.0",
        ...releaseImages,
        searxngImage: "docker.io/searxng/searxng:latest",
      }),
    ).toThrow("invalid SearXNG image");
  });
});
