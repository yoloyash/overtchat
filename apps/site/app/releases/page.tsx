import type { Metadata } from "next";
import { GitHubIcon } from "@/components/GitHubIcon";
import { ReleaseCard } from "@/components/ReleaseCard";
import { ReleaseFilter } from "@/components/ReleaseFilter";
import { createPageMetadata } from "@/lib/metadata";
import { fetchGithubReleases } from "@/lib/releases.server";

export const metadata: Metadata = createPageMetadata({
  title: "Releases",
  description:
    "Every stable OvertChat web, mobile, and desktop release, with notes and downloads in one chronological log.",
  path: "/releases/",
});

export default async function ReleasesPage() {
  const releases = await fetchGithubReleases();
  const webCount = releases.filter((release) => release.platform === "web").length;
  const mobileCount = releases.filter((release) => release.platform === "mobile").length;
  const desktopCount = releases.filter((release) => release.platform === "desktop").length;

  return (
    <main className="site-main" id="main-content" tabIndex={-1}>
      <section className="page-hero site-container release-page-hero">
        <div>
          <p className="eyebrow">Built in public</p>
          <h1 className="page-title">What shipped.</h1>
        </div>
        <div>
          <p className="page-lede">
            Follow OvertChat as it gets faster, more capable, and easier to run.
            Every stable web, mobile, and desktop release lands here directly from GitHub.
          </p>
          <a
            className="text-link"
            href="https://github.com/yoloyash/overtchat/releases"
          >
            <GitHubIcon aria-hidden="true" />
            View releases on GitHub
          </a>
          <a
            className="text-link"
            href="https://github.com/yoloyash/overtchat/blob/main/docs/deploy.md#desktop"
          >
            Desktop installation guide
          </a>
        </div>
      </section>

      <section className="site-container release-section">
        <ReleaseFilter
          counts={{ all: releases.length, web: webCount, mobile: mobileCount, desktop: desktopCount }}
        >
          {releases.map((release) => (
            <ReleaseCard release={release} key={release.tagName} />
          ))}
        </ReleaseFilter>
      </section>
    </main>
  );
}
