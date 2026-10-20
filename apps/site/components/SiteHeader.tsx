"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GitHubIcon } from "@/components/GitHubIcon";
import { ThemeToggle } from "@/components/ThemeToggle";

export function SiteHeader() {
  const pathname = usePathname().replace(/\/$/, "");

  return (
    <header className="site-header">
      <div className="site-container header-inner">
        <Link className="wordmark" href="/" aria-label="OvertChat home">
          overtchat
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          <Link className="nav-downloads" href="/downloads/" aria-current={pathname === "/downloads" ? "page" : undefined}>Downloads</Link>
          <Link className="nav-setup" href="/setup/" aria-label="Set up a server" aria-current={pathname === "/setup" ? "page" : undefined}>
            <span className="nav-setup-full">Set up a server</span>
            <span className="nav-setup-short" aria-hidden="true">Set up</span>
          </Link>
          <Link href="/releases/" aria-current={pathname === "/releases" ? "page" : undefined}>Releases</Link>
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
