import type { Metadata } from "next";
import { GitHubIcon } from "@/components/GitHubIcon";
import { ReleaseCard } from "@/components/ReleaseCard";
import { ReleaseFilter } from "@/components/ReleaseFilter";
import { absoluteSiteUrl } from "@/lib/site";
import { fetchGithubReleases } from "@/lib/releases";

export const metadata: Metadata = {
  title: "Releases",
  description: "Web and mobile release notes for OvertChat.",
  alternates: {
    canonical: absoluteSiteUrl("/releases/"),
  },
  openGraph: {
    title: "OvertChat releases",
    description: "Web and mobile release notes for OvertChat.",
    url: absoluteSiteUrl("/releases/"),
  },
};

export default async function ReleasesPage() {
  const releases = await fetchGithubReleases();
  const webCount = releases.filter((release) => release.platform === "web").length;
  const mobileCount = releases.length - webCount;

  return (
    <main className="site-main">
      <section className="page-hero site-container release-page-hero">
        <div>
          <p className="eyebrow">Changelog</p>
          <h1 className="page-title">What shipped.</h1>
        </div>
        <div>
          <p className="page-lede">
            Every stable web and mobile release, in one place. This page is
            generated directly from GitHub Releases whenever the project ships.
          </p>
          <a
            className="text-link"
            href="https://github.com/yoloyash/overtchat/releases"
          >
            <GitHubIcon aria-hidden="true" />
            View releases on GitHub
          </a>
        </div>
      </section>

      <section className="site-container release-section">
        <ReleaseFilter
          counts={{ all: releases.length, web: webCount, mobile: mobileCount }}
        >
          {releases.map((release) => (
            <ReleaseCard release={release} key={release.tagName} />
          ))}
        </ReleaseFilter>
      </section>
    </main>
  );
}
