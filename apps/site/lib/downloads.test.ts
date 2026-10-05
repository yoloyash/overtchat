import { describe, expect, it } from "vitest";
import { getDownloads } from "./downloads";
import { normalizeReleases } from "./releases";

function release(tag: string, date: string, names: string[], overrides = {}) {
  return {
    tag_name: tag,
    published_at: date,
    draft: false,
    prerelease: false,
    assets: names.map((name) => ({
      name,
      browser_download_url: `https://github.com/yoloyash/overtchat/releases/download/${tag}/${name}`,
    })),
    ...overrides,
  };
}

function desktop(version: string, date: string, overrides = {}) {
  return release(`desktop-v${version}`, date, [
    `overtchat-${version}-mac-arm64.dmg`,
    `overtchat-${version}-mac-x64.dmg`,
    `overtchat-${version}-linux-x64.deb`,
    `overtchat-${version}-linux-x64.rpm`,
    "overtchat-linux-x64.AppImage",
    "stable-linux.yml",
    "desktop-checksums-arm64.txt",
  ], overrides);
}

describe("getDownloads", () => {
  it("selects the newest public desktop and APK independently of server releases", () => {
    const downloads = getDownloads(normalizeReleases([
      desktop("0.1.0", "2026-01-01"),
      desktop("0.2.0", "2026-02-01"),
      desktop("0.3.0", "2026-04-01", { draft: true }),
      desktop("0.4.0", "2026-05-01", { prerelease: true }),
      release("mobile-v1.0.0", "2026-01-01", ["overtchat-v1.0.0.apk"]),
      release("mobile-v1.1.0", "2026-02-02", ["overtchat-v1.1.0.apk"]),
      release("mobile-v1.2.0", "2026-03-01", ["overtchat-v1.2.0.apk"], { draft: true }),
      release("v9.0.0", "2026-06-01", ["overtchat-v9.0.0.apk"]),
    ]));

    expect(downloads.version).toBe("0.2.0");
    expect(downloads.macArm.downloadUrl).toContain("desktop-v0.2.0/overtchat-0.2.0-mac-arm64.dmg");
    expect(downloads.macIntel.name).toBe("overtchat-0.2.0-mac-x64.dmg");
    expect(downloads.deb.name).toBe("overtchat-0.2.0-linux-x64.deb");
    expect(downloads.rpm.name).toBe("overtchat-0.2.0-linux-x64.rpm");
    expect(downloads.appImage.downloadUrl).toContain("desktop-v0.2.0/overtchat-linux-x64.AppImage");
    expect(downloads.apk?.downloadUrl).toContain("mobile-v1.1.0/overtchat-v1.1.0.apk");
  });

  it("supports the original versioned AppImage filename", () => {
    const candidate = desktop("0.1.0", "2026-01-01");
    candidate.assets = candidate.assets.map((asset) => ({
      ...asset,
      name: asset.name.replace("overtchat-linux", "overtchat-0.1.0-linux"),
      browser_download_url: asset.browser_download_url.replace("overtchat-linux", "overtchat-0.1.0-linux"),
    }));
    expect(getDownloads(normalizeReleases([candidate])).appImage.name)
      .toBe("overtchat-0.1.0-linux-x64.AppImage");
  });

  it("fails the build if the newest desktop is incomplete instead of mixing versions", () => {
    const candidate = desktop("0.2.0", "2026-02-01");
    candidate.assets = candidate.assets.filter((asset) => !asset.name.endsWith(".deb"));
    expect(() => getDownloads(normalizeReleases([
      candidate, desktop("0.1.0", "2026-01-01"),
    ]))).toThrow("Missing download in desktop-v0.2.0: overtchat-0.2.0-linux-x64.deb");
    expect(() => getDownloads([])).toThrow("No stable desktop release");
  });

  it("omits an unavailable APK without advertising an older mobile version", () => {
    const downloads = getDownloads(normalizeReleases([
      desktop("0.2.0", "2026-02-01"),
      release("mobile-v1.0.0", "2026-01-01", ["overtchat-v1.0.0.apk"]),
      release("mobile-v1.1.0", "2026-02-01", []),
    ]));
    expect(downloads.apk).toBeUndefined();
  });
});
