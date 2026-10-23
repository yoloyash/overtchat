import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { ChatShare } from "@overtchat/shared";
import { withShareUrl } from "./share-url";
import { shareUrl } from "./queries/shares";
import { setApiOrigin } from "./api-url";

const share: ChatShare = {
  id: "token",
  chatId: "chat",
  title: "Test",
  createdAt: "",
  updatedAt: "",
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setApiOrigin("http://localhost");
});

it.each([
  "http://192.168.1.20:4718",
  "https://smiths.overtchat.app",
  "https://chat.example.com",
])(
  "publishes the configured address %s independently of the connection URL",
  (origin) => {
    vi.stubEnv("BETTER_AUTH_URL", origin);
    setApiOrigin("http://192.168.1.20:4718");
    const result = withShareUrl(share);
    expect(result.url).toBe(`${origin}/share/token`);
    expect(shareUrl(result)).toBe(`${origin}/share/token`);
  },
);

it.each([
  "",
  "bad url",
  "http://localhost:4717",
  "http://127.0.0.1:4717",
  "http://[::1]:4717",
])("does not send recipients a loopback/default URL (%s)", (origin) => {
  vi.stubEnv("BETTER_AUTH_URL", origin);
  expect(withShareUrl(share)).toEqual(share);
  setApiOrigin("http://10.0.0.10:4718");
  expect(shareUrl(share)).toBe("http://10.0.0.10:4718/share/token");
});
