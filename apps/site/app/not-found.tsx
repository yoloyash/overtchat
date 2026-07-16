import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found site-container">
      <p className="eyebrow">404</p>
      <h1 className="page-title">Nothing here.</h1>
      <p className="page-lede">
        This page either moved or never shipped. The project site and release
        log are still right where they should be.
      </p>
      <Link className="button button-primary" href="/">
        <ArrowLeft aria-hidden="true" />
        Back to OvertChat
      </Link>
    </main>
  );
}
