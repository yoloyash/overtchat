import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReleaseCard } from "./ReleaseCard";

vi.mock("lucide-react", () => ({
  ArrowUpRight: () => null,
  Download: () => null,
}));

describe("ReleaseCard", () => {
  it("renders safe Markdown props without serializing syntax-tree nodes", () => {
    const html = renderToStaticMarkup(
      <ReleaseCard
        release={{
          tagName: "v1.0.0",
          name: "Version 1.0.0",
          body: "## Changes\n\n[Read more](https://example.com/release)",
          publishedAt: "2026-01-01T00:00:00Z",
          url: "https://github.com/yoloyash/overtchat/releases/tag/v1.0.0",
          platform: "web",
          assets: [],
        }}
      />,
    );

    expect(html).not.toContain('node="');
    expect(html).toContain("<h3>Changes</h3>");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
