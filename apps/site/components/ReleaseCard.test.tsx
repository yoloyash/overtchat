import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReleaseCard } from "./ReleaseCard";

vi.mock("lucide-react", () => ({
  ArrowUpRight: () => null,
  Download: () => null,
}));

describe("ReleaseCard", () => {
  it("keeps desktop downloads and checksums while hiding updater metadata", () => {
    const names = [
      "overtchat-mac-arm64.dmg",
      "overtchat-linux-x64.AppImage",
      "SHA256SUMS",
      "latest-mac.yml",
      "stable-linux.yaml",
      "overtchat-mac-arm64.dmg.blockmap",
    ];
    const html = renderToStaticMarkup(
      <ReleaseCard
        release={{
          tagName: "desktop-v1.0.0",
          name: "Desktop 1.0.0",
          body: "",
          publishedAt: "2026-01-01T00:00:00Z",
          url: "https://github.com/yoloyash/overtchat/releases/tag/desktop-v1.0.0",
          platform: "desktop",
          assets: names.map((name) => ({
            name,
            downloadUrl: `https://example.com/${name}`,
            size: 1024,
            contentType: "application/octet-stream",
          })),
        }}
      />,
    );

    for (const name of names.slice(0, 3)) {
      expect(html).toContain(`href="https://example.com/${name}"`);
    }
    for (const name of names.slice(3)) {
      expect(html).not.toContain(name);
    }
    expect(html).toContain('aria-label="View desktop-v1.0.0 on GitHub"');
  });

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
