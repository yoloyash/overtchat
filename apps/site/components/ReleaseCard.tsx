import { ArrowUpRight, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ProductRelease } from "@/lib/releases";

const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "Download";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function ReleaseCard({ release }: { release: ProductRelease }) {
  return (
    <article className="release-card" data-platform={release.platform}>
      <div className="release-rail">
        <span className={`platform-badge platform-${release.platform}`}>
          {release.platform}
        </span>
        <time dateTime={release.publishedAt}>
          {dateFormatter.format(new Date(release.publishedAt))}
        </time>
      </div>
      <div className="release-content">
        <header className="release-card-header">
          <div>
            <span className="release-tag">{release.tagName}</span>
            <h2>{release.name}</h2>
          </div>
          <a
            className="release-source-link"
            href={release.url}
            aria-label={`View ${release.tagName} on GitHub`}
          >
            GitHub <ArrowUpRight aria-hidden="true" />
          </a>
        </header>
        {release.body ? (
          <div className="release-markdown prose prose-sm">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              components={{
                a: ({ children, href, title }) => (
                  <a
                    href={href}
                    title={title}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                h1: ({ children }) => <h3>{children}</h3>,
                h2: ({ children }) => <h3>{children}</h3>,
                h3: ({ children }) => <h4>{children}</h4>,
                h4: ({ children }) => <h5>{children}</h5>,
                h5: ({ children }) => <h6>{children}</h6>,
                h6: ({ children }) => <h6>{children}</h6>,
              }}
            >
              {release.body}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="release-empty">No additional notes were published for this release.</p>
        )}
        {release.assets.length > 0 && (
          <div className="release-assets" aria-label="Release downloads">
            {release.assets.map((asset) => (
              <a href={asset.downloadUrl} key={asset.downloadUrl}>
                <Download aria-hidden="true" />
                <span>{asset.name}</span>
                <small>{formatBytes(asset.size)}</small>
              </a>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
