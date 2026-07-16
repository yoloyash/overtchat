import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-container footer-inner">
        <div>
          <div className="footer-wordmark">overtchat</div>
          <p>A lightweight self-hosted chat client that stays out of your way.</p>
        </div>
        <nav className="footer-links" aria-label="Footer navigation">
          <Link href="/releases/">Releases</Link>
          <Link href="/privacy/">Privacy</Link>
          <a href="https://github.com/yoloyash/overtchat/blob/main/docs/deploy.md">
            Deploy docs
          </a>
          <a href="https://github.com/yoloyash/overtchat">Source</a>
        </nav>
      </div>
      <div className="site-container footer-meta">
        <span>MIT licensed.</span>
        <span>No telemetry. No hosted backend.</span>
      </div>
    </footer>
  );
}
