import { describe, expect, it } from "vitest";
import { classifyReleaseTag, normalizeReleases } from "./releases";

function apiRelease(
  tagName: string,
  publishedAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    tag_name: tagName,
    name: `${tagName} release`,
    body: "## Changes\n- Useful improvement",
    published_at: publishedAt,
    html_url: `https://github.com/yoloyash/overtchat/releases/tag/${tagName}`,
    draft: false,
    prerelease: false,
    assets: [],
    ...overrides,
  };
}

describe("classifyReleaseTag", () => {
  it("classifies product tags and rejects unrelated component tags", () => {
    expect(classifyReleaseTag("v0.9.11")).toBe("web");
    expect(classifyReleaseTag("mobile-v1.2.3")).toBe("mobile");
    expect(classifyReleaseTag("desktop-v0.1.0")).toBe("desktop");
    expect(classifyReleaseTag("cli-v0.3.4")).toBeNull();
    expect(classifyReleaseTag("connector-v0.12.4")).toBeNull();
    expect(classifyReleaseTag("docs-preview")).toBeNull();
  });
});

describe("normalizeReleases", () => {
  it("filters unstable and unrelated releases, then orders newest first", () => {
    const releases = normalizeReleases([
      apiRelease("v1.0.0", "2026-01-01T00:00:00Z"),
      apiRelease("mobile-v2.0.0", "2026-03-01T00:00:00Z"),
      apiRelease("desktop-v0.1.0", "2026-03-02T00:00:00Z"),
      apiRelease("desktop-v0.2.0", "2026-06-01T00:00:00Z", { draft: true }),
      apiRelease("desktop-v0.3.0", "2026-07-01T00:00:00Z", { prerelease: true }),
      apiRelease("v1.1.0-beta", "2026-04-01T00:00:00Z", {
        prerelease: true,
      }),
      apiRelease("internal-tag", "2026-05-01T00:00:00Z"),
      apiRelease("v0.9.0", "2025-01-01T00:00:00Z", { draft: true }),
    ]);

    expect(releases.map((release) => release.tagName)).toEqual([
      "desktop-v0.1.0",
      "mobile-v2.0.0",
      "v1.0.0",
    ]);
    expect(releases.map((release) => release.platform)).toEqual([
      "desktop",
      "mobile",
      "web",
    ]);
  });

  it("preserves desktop downloads and checksums from a public release", () => {
    const names = [
      "overtchat-0.1.0-mac-arm64.dmg",
      "overtchat-0.1.0-mac-x64.zip",
      "overtchat-0.1.0-linux-x64.AppImage",
      "overtchat-0.1.0-linux-x64.deb",
      "overtchat-0.1.0-linux-x64.rpm",
      "overtchat-0.1.0-linux-x64.tar.gz",
      "desktop-checksums-linux-x64.txt",
    ];
    const [release] = normalizeReleases([
      apiRelease("desktop-v0.1.0", "2026-03-01T00:00:00Z", {
        assets: names.map((name) => ({
          name,
          browser_download_url: `https://github.com/yoloyash/overtchat/releases/download/desktop-v0.1.0/${name}`,
          content_type: "application/octet-stream",
          size: 1234,
        })),
      }),
    ]);
    expect(release.platform).toBe("desktop");
    expect(release.assets.map((asset) => asset.name)).toEqual(names);
  });

  it("supplies optional fallbacks and maps valid downloadable assets", () => {
    const [release] = normalizeReleases([
      apiRelease("mobile-v1.0.0", "2026-02-01T00:00:00Z", {
        name: null,
        body: null,
        html_url: null,
        assets: [
          {
            name: "overtchat.apk",
            browser_download_url: "https://example.com/overtchat.apk",
            content_type: "application/vnd.android.package-archive",
            size: 1234,
          },
          { name: "missing-url.apk" },
          {
            name: "insecure.apk",
            browser_download_url: "http://example.com/insecure.apk",
          },
        ],
      }),
    ]);

    expect(release).toMatchObject({
      name: "mobile-v1.0.0",
      body: "",
      url: "https://github.com/yoloyash/overtchat/releases/tag/mobile-v1.0.0",
      assets: [
        {
          name: "overtchat.apk",
          downloadUrl: "https://example.com/overtchat.apk",
          contentType: "application/vnd.android.package-archive",
          size: 1234,
        },
      ],
    });
  });

  it("rejects invalid dates and unsafe release URLs", () => {
    expect(
      normalizeReleases([
        apiRelease("v1.0.0", "not-a-date"),
        apiRelease("v1.1.0", "2026-03-01T00:00:00Z", {
          html_url: "javascript:alert(1)",
        }),
      ]),
    ).toMatchObject([
      {
        tagName: "v1.1.0",
        url: "https://github.com/yoloyash/overtchat/releases/tag/v1.1.0",
      },
    ]);
  });
});
