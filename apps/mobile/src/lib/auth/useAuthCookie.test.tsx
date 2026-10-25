import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  defaultScheduler,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  server: "https://first.example",
  session: { id: "first", updatedAt: "one" } as {
    id: string;
    updatedAt: string;
  } | null,
  cookie: vi.fn<() => Promise<string>>(),
}));
vi.mock("@/lib/api", () => ({ getApiBase: () => mocks.server }));
vi.mock("./client", () => ({
  getAuthClient: () => ({
    useSession: () => ({
      data: mocks.session ? { session: mocks.session } : null,
    }),
    getCookie: mocks.cookie,
  }),
}));
import { useAuthCookie } from "./useAuthCookie";

let root: Root;
let client: QueryClient;
let cookie: string | undefined;
function Probe() {
  cookie = useAuthCookie();
  return null;
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
}
async function settle(done: () => void) {
  await act(async () => {
    done();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
beforeEach(() => {
  // Deliver query updates as microtasks, ahead of settle()'s timer even when
  // a busy machine stalls the process.
  notifyManager.setScheduler(queueMicrotask);
  mocks.server = "https://first.example";
  mocks.session = { id: "first", updatedAt: "one" };
  mocks.cookie.mockReset();
  const { window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(
    window.document.getElementById("root") as unknown as HTMLElement,
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
  notifyManager.setScheduler(defaultScheduler);
});

it("withholds image/notification credentials until storage resolves and clears them on logout", async () => {
  let finish!: (cookie: string) => void;
  mocks.cookie.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  expect(cookie).toBeUndefined();
  await settle(() => finish("first-cookie"));
  expect(cookie).toBe("first-cookie");
  mocks.session = null;
  await render();
  expect(cookie).toBeUndefined();
});

it("ignores a previous server's delayed storage read after switching identity", async () => {
  let first!: (cookie: string) => void;
  let second!: (cookie: string) => void;
  mocks.cookie
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          second = resolve;
        }),
    );
  await render();
  mocks.server = "https://second.example";
  mocks.session = { id: "second", updatedAt: "one" };
  await render();
  await settle(() => first("old-cookie"));
  expect(cookie).toBeUndefined();
  await settle(() => second("new-cookie"));
  expect(cookie).toBe("new-cookie");
});

it("reads refreshed session cookies without displaying the prior value while pending", async () => {
  mocks.cookie.mockResolvedValueOnce("first-cookie");
  await render();
  await settle(() => {});
  expect(cookie).toBe("first-cookie");
  let finish!: (cookie: string) => void;
  mocks.cookie.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mocks.session = { id: "first", updatedAt: "two" };
  await render();
  expect(cookie).toBeUndefined();
  await settle(() => finish("refreshed-cookie"));
  expect(cookie).toBe("refreshed-cookie");
});
