import "server-only";

import { retry } from "@octokit/plugin-retry";
import { Octokit } from "@octokit/rest";
import { normalizeReleases, type ProductRelease } from "./releases";

const GitHubOctokit = Octokit.plugin(retry);
const RELEASES_ROUTE = "GET /repos/{owner}/{repo}/releases" as const;
const GITHUB_API_VERSION = "2026-03-10";
const REQUEST_TIMEOUT_MS = 15_000;

interface ReleasePaginationOptions {
  owner: string;
  repo: string;
  per_page: number;
  headers: {
    "x-github-api-version": string;
  };
}

export type ReleasePaginator = (
  route: typeof RELEASES_ROUTE,
  options: ReleasePaginationOptions,
) => Promise<unknown[]>;

function createReleasePaginator(): ReleasePaginator {
  const octokit = new GitHubOctokit({
    auth: process.env.GITHUB_TOKEN || undefined,
    userAgent: "overtchat-project-site",
    request: {
      timeout: REQUEST_TIMEOUT_MS,
    },
  });

  return async (route, options) => octokit.paginate(route, options);
}

export async function fetchGithubReleases(
  paginate: ReleasePaginator = createReleasePaginator(),
): Promise<ProductRelease[]> {
  let rawReleases: unknown[];

  try {
    rawReleases = await paginate(RELEASES_ROUTE, {
      owner: "yoloyash",
      repo: "overtchat",
      per_page: 100,
      headers: {
        "x-github-api-version": GITHUB_API_VERSION,
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown GitHub API error";
    throw new Error(`GitHub Releases request failed: ${detail}`, {
      cause: error,
    });
  }

  const releases = normalizeReleases(rawReleases);
  if (releases.length === 0) {
    throw new Error("No stable OvertChat releases were returned by GitHub");
  }

  return releases;
}
