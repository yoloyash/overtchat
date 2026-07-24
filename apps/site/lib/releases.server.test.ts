import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchGithubReleases } from "./releases.server";

function apiRelease(tagName = "v1.0.0") {
  return {
    tag_name: tagName,
    name: `${tagName} release`,
    body: "Useful improvement",
    published_at: "2026-01-01T00:00:00Z",
    html_url: `https://github.com/yoloyash/overtchat/releases/tag/${tagName}`,
    draft: false,
    prerelease: false,
    assets: [],
  };
}

describe("fetchGithubReleases", () => {
  it("delegates pagination to Octokit with the current API version", async () => {
    const paginate = vi.fn().mockResolvedValue([apiRelease()]);

    const releases = await fetchGithubReleases(paginate);

    expect(paginate).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/releases",
      {
        owner: "yoloyash",
        repo: "overtchat",
        per_page: 100,
        headers: {
          "x-github-api-version": "2026-03-10",
        },
      },
    );
    expect(releases).toHaveLength(1);
  });

  it("fails instead of publishing an incomplete feed", async () => {
    const paginate = vi.fn().mockRejectedValue(new Error("rate limited"));

    await expect(fetchGithubReleases(paginate)).rejects.toThrow(
      "GitHub Releases request failed: rate limited",
    );
  });

  it("fails when GitHub returns no stable product releases", async () => {
    const paginate = vi.fn().mockResolvedValue([
      apiRelease("internal-preview"),
    ]);

    await expect(fetchGithubReleases(paginate)).rejects.toThrow(
      "No stable OvertChat releases were returned by GitHub",
    );
  });
});
