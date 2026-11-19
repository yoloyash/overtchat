import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listProviderModels, createConfiguredLanguageModel } from "./registry";
import {
  applyHeaders,
  connectionHeaders,
  fetchWithHeaders,
} from "./request-headers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Records each outgoing request and fails it, which is all a header check needs. */
function captureRequests() {
  const requests: { url: string; headers: Headers }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: input instanceof Request ? input.url : String(input),
        headers: new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        ),
      });
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return requests;
}

describe("connectionHeaders", () => {
  it("returns nothing for a connection without headers", () => {
    expect(connectionHeaders({})).toBeUndefined();
    expect(connectionHeaders({ headers: null, chatId: "chat" })).toBeUndefined();
    expect(connectionHeaders({ headers: {} })).toBeUndefined();
  });

  it("gives every request of one chat the same ID and other chats another", () => {
    const headers = { "x-session": "{{CHAT_ID}}", "X-Static": "fixed" };
    const first = connectionHeaders({ headers, chatId: "chat-one" });
    const again = connectionHeaders({ headers, chatId: "chat-one" });
    const other = connectionHeaders({ headers, chatId: "chat-two" });
    expect(first).toEqual(again);
    expect(first?.["X-Static"]).toBe("fixed");
    expect(first?.["x-session"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(other?.["x-session"]).not.toBe(first?.["x-session"]);
  });

  it("never sends the chat ID itself, whatever characters it holds", () => {
    const chatId = "chat\r\nX-Injected: 1 ✓";
    const value = connectionHeaders({
      headers: { "x-session": "s-{{CHAT_ID}}" },
      chatId,
    })?.["x-session"];
    expect(value).toMatch(/^s-[A-Za-z0-9_-]{43}$/);
    expect(() => new Headers({ "x-session": value ?? "" })).not.toThrow();
  });

  it("uses one fresh ID per request outside a chat", () => {
    const headers = { "x-session": "{{CHAT_ID}}", "x-trace": "t-{{CHAT_ID}}" };
    const first = connectionHeaders({ headers });
    const second = connectionHeaders({ headers });
    expect(first?.["x-session"]).toMatch(UUID);
    expect(first?.["x-trace"]).toBe(`t-${first?.["x-session"]}`);
    expect(second?.["x-session"]).not.toBe(first?.["x-session"]);
  });

  it("leaves unknown placeholders as written", () => {
    expect(connectionHeaders({ headers: { "X-User": "{{USER_ID}}" } })).toEqual(
      { "X-User": "{{USER_ID}}" },
    );
  });
});

describe("applying headers", () => {
  it("replaces a header of the same name in any case", () => {
    const merged = applyHeaders(
      { Authorization: "Bearer none", Accept: "application/json" },
      { authorization: "Basic abc", "X-Extra": "1" },
    );
    expect(merged.get("authorization")).toBe("Basic abc");
    expect(merged.get("accept")).toBe("application/json");
    expect(merged.get("x-extra")).toBe("1");
  });

  it("keeps the original fetch when there is nothing to add", () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(fetchWithHeaders(undefined, fetcher)).toBe(fetcher);
    expect(fetchWithHeaders({}, fetcher)).toBe(fetcher);
  });
});

describe("requests to a model's endpoint", () => {
  const headers = {
    "x-opencode-session": "{{CHAT_ID}}",
    authorization: "Basic override",
  };

  it.each([
    ["custom", "openai-chat", "/chat/completions"],
    ["custom", "openai-responses", "/responses"],
    ["custom", "anthropic-messages", "/messages"],
    ["openai", "auto", "/responses"],
    ["anthropic", "auto", "/messages"],
    ["google", "auto", ":generateContent"],
    ["openrouter", "auto", "/chat/completions"],
    ["vllm", "auto", "/chat/completions"],
  ] as const)(
    "carry the headers for %s (%s)",
    async (providerId, apiFormat, path) => {
      const requests = captureRequests();
      const send = async (chatId: string) => {
        const { model } = createConfiguredLanguageModel({
          providerId,
          apiFormat,
          baseUrl: "https://gateway.example/v1",
          apiKey: "saved-key",
          model: "gateway-model",
          providerOptions: null,
          headers,
          chatId,
        });
        // The stub's reply is not a completion; only the request matters.
        await generateText({ model, prompt: "hi", maxRetries: 0 }).catch(
          () => undefined,
        );
      };
      await send("chat-one");
      await send("chat-one");
      await send("chat-two");

      expect(requests).toHaveLength(3);
      for (const request of requests) {
        expect(request.url).toContain(path);
        expect(request.headers.get("authorization")).toBe("Basic override");
      }
      const [first, again, other] = requests.map((request) =>
        request.headers.get("x-opencode-session"),
      );
      expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(again).toBe(first);
      expect(other).not.toBe(first);
    },
  );

  it("sends nothing extra for a model without headers", async () => {
    const requests = captureRequests();
    const { model } = createConfiguredLanguageModel({
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl: "https://gateway.example/v1",
      apiKey: "saved-key",
      model: "gateway-model",
      providerOptions: null,
      chatId: "chat-one",
    });
    await generateText({ model, prompt: "hi", maxRetries: 0 }).catch(
      () => undefined,
    );
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer saved-key");
    expect(requests[0]?.headers.has("x-opencode-session")).toBe(false);
  });

  it.each([
    ["custom", "openai-chat"],
    ["custom", "anthropic-messages"],
    ["google", "auto"],
    ["openrouter", "auto"],
    ["llamacpp", "auto"],
  ] as const)(
    "carry the headers on model discovery for %s (%s)",
    async (providerId, apiFormat) => {
      const requests = captureRequests();
      await listProviderModels({
        providerId,
        apiFormat,
        baseUrl: "https://gateway.example/v1",
        apiKey: "saved-key",
        headers: { "x-opencode-session": "{{CHAT_ID}}", "X-Team": "search" },
      });
      expect(requests.length).toBeGreaterThan(0);
      for (const request of requests) {
        expect(request.headers.get("x-opencode-session")).toMatch(UUID);
        expect(request.headers.get("x-team")).toBe("search");
      }
    },
  );
});
