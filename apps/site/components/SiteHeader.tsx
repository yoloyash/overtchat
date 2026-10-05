import Link from "next/link";
import { GitHubIcon } from "@/components/GitHubIcon";
import { ThemeToggle } from "@/components/ThemeToggle";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-container header-inner">
        <Link className="wordmark" href="/" aria-label="OvertChat home">
          overtchat
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          <Link className="nav-downloads" href="/downloads/">Downloads</Link>
          <Link className="nav-setup" href="/setup/" aria-label="Set up a server">
            <span className="nav-setup-full">Set up a server</span>
            <span className="nav-setup-short" aria-hidden="true">Set up</span>
          </Link>
          <Link href="/releases/">Releases</Link>
          <a
            className="icon-button"
            href="https://github.com/yoloyash/overtchat"
            aria-label="OvertChat on GitHub"
            title="OvertChat on GitHub"
          >
            <GitHubIcon aria-hidden="true" />
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
