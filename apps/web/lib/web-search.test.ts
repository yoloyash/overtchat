import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCapability: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/serverCapabilities", () => ({
  getServerCapability: mocks.getCapability,
}));

import { searxngSearch } from "./web";

describe("configured web search provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps bundled search on the internal SearXNG service", async () => {
    mocks.getCapability.mockReturnValue({ provider: "bundled" });
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          { url: "https://example.com", title: "Example", content: "Result" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searxngSearch("hello", 1)).resolves.toEqual([
      { link: "https://example.com", title: "Example", snippet: "Result" },
    ]);
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.origin).toBe("http://searxng:8080");
    expect(url.searchParams.get("q")).toBe("hello");
  });

  it("uses Brave's API and subscription token", async () => {
    mocks.getCapability.mockReturnValue({
      provider: "brave",
      apiKey: "brave-key",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        web: {
          results: [
            {
              url: "https://example.com/brave",
              title: "Brave result",
              description: "Description",
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searxngSearch("query", 3)).resolves.toEqual([
      {
        link: "https://example.com/brave",
        title: "Brave result",
        snippet: "Description",
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.hostname).toBe("api.search.brave.com");
    expect(init.headers).toMatchObject({
      "X-Subscription-Token": "brave-key",
    });
  });

  it("fails closed when server search is disabled", async () => {
    mocks.getCapability.mockReturnValue({ provider: "disabled" });
    await expect(searxngSearch("query")).rejects.toThrow(
      "Web search is disabled on this server.",
    );
  });
});
