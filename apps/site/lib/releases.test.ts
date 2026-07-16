import { describe, expect, it, vi } from "vitest";
import {
  classifyReleaseTag,
  fetchGithubReleases,
  normalizeReleases,
} from "./releases";

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
  it("classifies web and mobile product tags and rejects unrelated tags", () => {
    expect(classifyReleaseTag("v0.9.11")).toBe("web");
    expect(classifyReleaseTag("mobile-v1.2.3")).toBe("mobile");
    expect(classifyReleaseTag("docs-preview")).toBeNull();
  });
});

describe("normalizeReleases", () => {
  it("filters unstable and unrelated releases, then orders newest first", () => {
    const releases = normalizeReleases([
      apiRelease("v1.0.0", "2026-01-01T00:00:00Z"),
      apiRelease("mobile-v2.0.0", "2026-03-01T00:00:00Z"),
      apiRelease("v1.1.0-beta", "2026-04-01T00:00:00Z", {
        prerelease: true,
      }),
      apiRelease("internal-tag", "2026-05-01T00:00:00Z"),
      apiRelease("v0.9.0", "2025-01-01T00:00:00Z", { draft: true }),
    ]);

    expect(releases.map((release) => release.tagName)).toEqual([
      "mobile-v2.0.0",
      "v1.0.0",
    ]);
    expect(releases.map((release) => release.platform)).toEqual([
      "mobile",
      "web",
    ]);
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
});

describe("fetchGithubReleases", () => {
  it("paginates until GitHub returns fewer than 100 records", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      apiRelease(`v1.0.${index}`, `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}Z`),
    );
    const secondPage = [
      apiRelease("mobile-v1.0.0", "2026-02-01T00:00:00Z"),
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(firstPage))
      .mockResolvedValueOnce(Response.json(secondPage));

    const releases = await fetchGithubReleases(fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain("page=1");
    expect(String(fetcher.mock.calls[1][0])).toContain("page=2");
    expect(releases).toHaveLength(101);
    expect(releases[0].tagName).toBe("mobile-v1.0.0");
  });

  it("fails instead of publishing an incomplete feed", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("rate limited", {
        status: 403,
        statusText: "Forbidden",
      }),
    );

    await expect(fetchGithubReleases(fetcher)).rejects.toThrow(
      "GitHub Releases request failed (403 Forbidden)",
    );
  });
});
