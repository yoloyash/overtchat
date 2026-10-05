import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, ArrowRight, Monitor, Smartphone } from "lucide-react";
import { createPageMetadata } from "@/lib/metadata";
import { fetchGithubReleases } from "@/lib/releases.server";
import {
  APP_STORE_URL,
  GOOGLE_PLAY_URL,
  getDownloads,
} from "@/lib/downloads";

export const dynamic = "force-static";

export const metadata: Metadata = createPageMetadata({
  title: "Downloads",
  description:
    "Download OvertChat for macOS, Linux, Android, and iPhone or iPad. Connect to your own OvertChat server and pick up your conversations.",
  path: "/downloads/",
});

export default async function DownloadsPage() {
  const downloads = getDownloads(await fetchGithubReleases());

  return (
    <main className="site-main" id="main-content" tabIndex={-1}>
      <section className="page-hero site-container">
        <div>
          <p className="eyebrow">Desktop & mobile</p>
          <h1 className="page-title">Your chat.<br />On your device.</h1>
        </div>
        <div>
          <p className="page-lede">
            Connect to your OvertChat server. Enter your server address and sign
            in. These apps require an existing server; they don’t install the
            server or run models on your device.
          </p>
          <Link className="text-link" href="/setup/">
            Need a server? Set one up <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="site-container downloads-grid" aria-label="Download an app">
        <article className="download-card" id="macos">
          <Monitor className="download-icon" aria-hidden="true" />
          <div>
            <h2>macOS</h2>
            <p>Version {downloads.version} · macOS 13 or later</p>
          </div>
          <div className="download-actions">
            <a className="button button-primary" href={downloads.macArm.downloadUrl}>
              <ArrowDownToLine aria-hidden="true" /> Apple Silicon
            </a>
            <a className="button" href={downloads.macIntel.downloadUrl}>
              <ArrowDownToLine aria-hidden="true" /> Intel
            </a>
          </div>
          <p className="download-note">
            Choose Apple Silicon for M-series Macs. Open the DMG and drag
            OvertChat to Applications. Developer ID signed and notarized.
          </p>
          <a className="text-link" href="https://github.com/yoloyash/overtchat/blob/main/docs/deploy.md#macos-desktop">
            Installation help <ArrowRight aria-hidden="true" />
          </a>
        </article>

        <article className="download-card" id="linux">
          <Monitor className="download-icon" aria-hidden="true" />
          <div>
            <h2>Linux</h2>
            <p>Version {downloads.version} · x64</p>
          </div>
          <div className="download-actions">
            <a className="button button-primary" href={downloads.deb.downloadUrl}>
              <ArrowDownToLine aria-hidden="true" /> Ubuntu / Debian
            </a>
            <a className="button" href={downloads.rpm.downloadUrl}>
              <ArrowDownToLine aria-hidden="true" /> Fedora
            </a>
            <a className="button" href={downloads.appImage.downloadUrl}>
              <ArrowDownToLine aria-hidden="true" /> AppImage
            </a>
          </div>
          <p className="download-note">
            Use the .deb on Ubuntu or Debian, or the .rpm on Fedora.
            AppImage requires working user namespaces; use the .deb on Ubuntu 24.04.
          </p>
          <a className="text-link" href="https://github.com/yoloyash/overtchat/blob/main/docs/deploy.md#linux-desktop">
            Installation help <ArrowRight aria-hidden="true" />
          </a>
        </article>

        <article className="download-card" id="android">
          <Smartphone className="download-icon" aria-hidden="true" />
          <div>
            <h2>Android</h2>
            <p>Your conversations, wherever you are.</p>
          </div>
          <div className="download-actions">
            <a className="button button-primary" href={GOOGLE_PLAY_URL}>
              Get it on Google Play <ArrowRight aria-hidden="true" />
            </a>
          </div>
          <p className="download-note">
            Google Play keeps the app up to date. Enter a server address
            reachable from your phone and sign in with your existing account.
          </p>
          {downloads.apk && (
            <a className="text-link" href={downloads.apk.downloadUrl}>
              Download Android APK <ArrowDownToLine aria-hidden="true" />
            </a>
          )}
          {downloads.apk && <p className="download-note">Sideloaded APKs require manual updates.</p>}
        </article>

        <article className="download-card" id="ios">
          <Smartphone className="download-icon" aria-hidden="true" />
          <div>
            <h2>iPhone & iPad</h2>
            <p>Same server. Smaller screen.</p>
          </div>
          <div className="download-actions">
            <a className="button button-primary" href={APP_STORE_URL}>
              Get it on the App Store <ArrowRight aria-hidden="true" />
            </a>
          </div>
          <p className="download-note">
            Connect to your own OvertChat server from your iPhone or iPad.
            Your chats, projects, and files stay on your server.
          </p>
        </article>
      </section>

      <section className="site-container download-more" aria-label="More ways to use OvertChat">
        <div>
          <h2>Prefer your browser?</h2>
          <p>Open your server’s address in a browser and sign in. No download needed.</p>
          <Link className="text-link" href="/setup/">
            Set up a server <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        <div>
          <h2>Looking for another download?</h2>
          <p>Find ZIP and tar archives, checksums, and previous versions in the release log.
            Windows and Linux ARM64 apps are not available yet.</p>
          <Link className="text-link" href="/releases/">
            All downloads & release notes <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
