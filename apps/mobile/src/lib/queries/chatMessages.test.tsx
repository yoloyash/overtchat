import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChatMessages, type ChatMessagesResponse } from "./chatMessages";
import { queryKeys } from "./keys";

const request = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/api", () => ({
  getApiBase: () => "https://chat.example",
  authFetch: request,
}));
let root: Root;
let client: QueryClient;
let query: ReturnType<typeof useChatMessages>;
const key = queryKeys.chatMessages("chat");
const data: ChatMessagesResponse = { messages: [], kind: "text", projectId: null };
function Probe({ id = "chat" }: { id?: string | null }) {
  query = useChatMessages(id);
  return null;
}
async function mount(id: string | null = "chat") {
  await act(async () => root.render(
    <QueryClientProvider client={client}><Probe id={id} /></QueryClientProvider>,
  ));
}
async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
function deferredFetch() {
  let finish!: (response: Response) => void;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  return (response = Response.json(data)) => finish(response);
}
beforeEach(() => {
  request.mockReset().mockImplementation(async () => Response.json(data));
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(window.document.getElementById("root") as unknown as HTMLElement);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("keeps initial hydration and background invalidations out of pull-to-refresh state", async () => {
  const finish = deferredFetch();
  await mount();
  expect(query.isFetching).toBe(true);
  expect(query.refreshing).toBe(false);
  await act(async () => finish());
  await flush();
  let refetch!: Promise<void>;
  await act(async () => { refetch = client.invalidateQueries({ queryKey: key }); });
  await flush();
  expect(query.isFetching).toBe(true);
  expect(query.refreshing).toBe(false);
  await act(async () => { finish(); await refetch; });
  await flush();
  expect(query.refreshing).toBe(false);
});

it("shows manual progress until completion and ignores overlapping pulls", async () => {
  await mount();
  await flush();
  const finish = deferredFetch();
  let refresh!: ReturnType<typeof query.refresh>;
  await act(async () => { refresh = query.refresh(); });
  expect(query.refreshing).toBe(true);
  const calls = request.mock.calls.length;
  await act(async () => { await query.refresh(); });
  expect(request).toHaveBeenCalledTimes(calls);
  await act(async () => { finish(); await refresh; });
  expect(query.refreshing).toBe(false);
});

it("clears manual progress on failure and allows another pull", async () => {
  await mount();
  await flush();
  const finish = deferredFetch();
  let refresh!: ReturnType<typeof query.refresh>;
  await act(async () => { refresh = query.refresh(); });
  expect(query.refreshing).toBe(true);
  await act(async () => {
    finish(new Response(null, { status: 500 }));
    expect((await refresh)?.error?.message).toContain("500");
  });
  expect(query.refreshing).toBe(false);
  await act(async () => { refresh = query.refresh(); });
  expect(query.refreshing).toBe(true);
  await act(async () => { finish(); await refresh; });
  expect(query.refreshing).toBe(false);
});

it("does not fetch a new unsaved chat on pull", async () => {
  await mount(null);
  await act(async () => { await query.refresh(); });
  expect(request).not.toHaveBeenCalled();
  expect(query.refreshing).toBe(false);
});
