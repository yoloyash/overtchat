import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCapability: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/serverCapabilities", () => ({
  getServerCapability: mocks.getCapability,
}));

import { fetchReadable, searchWeb } from "./web";

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

    await expect(searchWeb("hello", 1)).resolves.toEqual({
      provider: "searxng",
      sources: [
        { url: "https://example.com/", title: "Example", snippet: "Result" },
      ],
    });
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.origin).toBe("http://searxng:8080");
    expect(url.searchParams.get("q")).toBe("hello");
  });

  it("uses the configured external SearXNG service", async () => {
    mocks.getCapability.mockReturnValue({
      provider: "searxng",
      baseUrl: "https://search.example.com/base",
      apiKey: "retained-inactive-brave-key",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            url: "https://example.com/external",
            title: "External result",
            content: "External SearXNG answered",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchWeb("external query")).resolves.toMatchObject({
      provider: "searxng",
      sources: [{ url: "https://example.com/external" }],
    });

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.origin).toBe("https://search.example.com");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("external query");
  });

  it("uses Brave Search with the stored subscription token", async () => {
    mocks.getCapability.mockReturnValue({
      provider: "brave",
      apiKey: "brave-key",
      bundledInstalled: false,
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

    await expect(searchWeb("query", 3)).resolves.toEqual({
      provider: "brave",
      authMode: "api_key",
      sources: [
        {
          url: "https://example.com/brave",
          title: "Brave result",
          snippet: "Description",
        },
      ],
    });

    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(rawUrl).hostname).toBe("api.search.brave.com");
    expect(init.headers).toMatchObject({
      "X-Subscription-Token": "brave-key",
    });
  });

  it("fails clearly when Brave has no API key", async () => {
    mocks.getCapability.mockReturnValue({
      provider: "brave",
      apiKey: null,
    });
    await expect(searchWeb("query")).rejects.toThrow(
      "Brave Search API key is not configured",
    );
  });

  it("falls back from Brave to configured SearXNG", async () => {
    mocks.getCapability.mockReturnValue({
      provider: "brave",
      apiKey: "brave-key",
      bundledInstalled: true,
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "api.search.brave.com") {
        return Response.json(
          { error: "subscription unavailable" },
          { status: 401 },
        );
      }
      return Response.json({
        results: [
          {
            url: "https://example.com/searxng-fallback",
            title: "SearXNG fallback",
            content: "Private configured fallback worked",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchWeb("brave fallback query", 1)).resolves.toEqual({
      provider: "searxng",
      sources: [
        {
          url: "https://example.com/searxng-fallback",
          title: "SearXNG fallback",
          snippet: "Private configured fallback worked",
        },
      ],
    });
    expect(
      fetchMock.mock.calls.map(([input]) => new URL(String(input)).hostname),
    ).toEqual(["api.search.brave.com", "searxng"]);
  });

  it("automatically falls back to the public chain", async () => {
    mocks.getCapability.mockReturnValue({ provider: "bundled" });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "searxng") {
        return Response.json({ error: "unavailable" }, { status: 503 });
      }
      if (url.hostname === "api.firecrawl.dev") {
        return Response.json({
          success: true,
          data: {
            web: [
              {
                url: "https://example.com/public-fallback",
                title: "Public fallback",
                description: "Firecrawl returned the first usable result",
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected search provider: ${url.hostname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchWeb("public fallback query", 1)).resolves.toEqual({
      provider: "firecrawl",
      authMode: "keyless",
      sources: [
        {
          url: "https://example.com/public-fallback",
          title: "Public fallback",
          snippet: "Firecrawl returned the first usable result",
        },
      ],
    });
    expect(
      fetchMock.mock.calls.map(([input]) => new URL(String(input)).hostname),
    ).toEqual(["searxng", "api.firecrawl.dev"]);
  });

  it("replaces the cached search client when the API key changes", async () => {
    mocks.getCapability.mockReturnValue({
      provider: "brave",
      apiKey: "first-key",
    });
    const fetchMock = vi.fn().mockImplementation(async () =>
      Response.json({
        web: {
          results: [
            { url: "https://example.com", title: "Example" },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await searchWeb("first query");
    mocks.getCapability.mockReturnValue({
      provider: "brave",
      apiKey: "second-key",
    });
    await searchWeb("second query");

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-Subscription-Token": "first-key",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      "X-Subscription-Token": "second-key",
    });
  });

  it("fails closed for an unsupported stored provider", async () => {
    mocks.getCapability.mockReturnValue({
      provider: "removed-provider",
    });
    await expect(searchWeb("query", 3)).rejects.toThrow(
      "configured web search provider is not supported",
    );
  });

  it("fails closed when server search is disabled", async () => {
    mocks.getCapability.mockReturnValue({ provider: "disabled" });
    await expect(searchWeb("query")).rejects.toThrow(
      "Web search is disabled on this server.",
    );
  });
});

describe("published Web Basics fetch integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves OvertChat's native fetched-page contract for HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          "<!doctype html><html><head><title>Test article</title></head>" +
            "<body><main><h1>Test article</h1>" +
            "<p>Hello from the article body with enough useful words.</p>" +
            "</main></body></html>",
          { headers: { "content-type": "text/html" } },
        ),
      ),
    );

    await expect(
      fetchReadable("https://1.1.1.1/overtchat-html-contract"),
    ).resolves.toMatchObject({
      kind: "text",
      url: "https://1.1.1.1/overtchat-html-contract",
      title: "Test article",
      content: "Hello from the article body with enough useful words.",
      wordCount: 9,
      contentType: "text/html",
      startIndex: 0,
      returnedChars: 53,
      totalChars: 53,
      truncated: false,
    });
  });

  it("reads a later text chunk using Web Basics pagination", async () => {
    const content = `${"a".repeat(8_000)}${"b".repeat(1_000)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(content, {
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    await expect(
      fetchReadable("https://1.1.1.1/overtchat-text-pagination", {
        startIndex: 8_000,
      }),
    ).resolves.toMatchObject({
      kind: "text",
      content: "b".repeat(1_000),
      startIndex: 8_000,
      returnedChars: 1_000,
      totalChars: 9_000,
      truncated: false,
    });
  });

  it("returns image bytes for the native tool boundary", async () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(pngBytes, {
          headers: { "content-type": "image/png" },
        }),
      ),
    );

    await expect(
      fetchReadable("https://1.1.1.1/overtchat-image-contract"),
    ).resolves.toEqual({
      kind: "image",
      url: "https://1.1.1.1/overtchat-image-contract",
      data: pngBytes,
      byteLength: pngBytes.byteLength,
      contentType: "image/png",
      extractor: "image",
    });
  });
});
