import { describe, expect, it } from "vitest";
import { existingInstallationSummary } from "./prompts.js";
import type { ExistingInstallation } from "./types.js";

function installation(
  overrides: Partial<ExistingInstallation> = {},
): ExistingInstallation {
  return {
    containerName: "overtchat-app",
    appVersion: "0.13.9",
    appImage: "ghcr.io/yoloyash/overtchat-app:0.13.9",
    composeProject: "overtchat",
    composeWorkingDir: "/home/yash/dev/overtchat",
    dataMountType: "volume",
    dataVolume: "overtchat_overtchat-data",
    appPort: 49317,
    bindAddress: "127.0.0.1",
    publicUrl: "https://chat.example.com",
    environment: new Map(),
    bundledServices: { search: true, tts: true, stt: true },
    sttAccelerator: "cpu",
    ...overrides,
  };
}

describe("existing installation summary", () => {
  it("makes the reused production resources and safety behavior explicit", () => {
    expect(existingInstallationSummary(installation())).toBe(
      [
        "Version: 0.13.9",
        "Address: https://chat.example.com",
        "Published port: 127.0.0.1:49317",
        "Data: Docker volume overtchat_overtchat-data",
        "Compose directory: /home/yash/dev/overtchat",
        "Bundled services: SearXNG, Kokoro, Parakeet (CPU)",
        "",
        "This storage will be reused. A verified SQLite snapshot will be created before the app is replaced or migrations run.",
      ].join("\n"),
    );
  });

  it("describes bind mounts and unavailable metadata honestly", () => {
    const summary = existingInstallationSummary(
      installation({
        appVersion: undefined,
        composeWorkingDir: undefined,
        dataMountType: "bind",
        dataVolume: "/srv/overtchat/data",
        bundledServices: { search: false, tts: false, stt: false },
      }),
    );

    expect(summary).toContain("Version: unknown");
    expect(summary).toContain("Data: Bind mount /srv/overtchat/data");
    expect(summary).toContain("Bundled services: none detected");
  });
});
