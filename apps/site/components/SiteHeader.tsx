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
          <Link href="/releases/">Releases</Link>
          <a href="https://github.com/yoloyash/overtchat">GitHub</a>
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
