import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdminModelConfig } from "@overtchat/shared/admin-settings";
import { modelDraft } from "@/lib/settings-model";
import { queryKeys } from "./keys";

vi.mock("@/lib/auth/client", () => ({ getAuthClient: vi.fn() }));
vi.mock("@/lib/api", () => ({
  authFetch: vi.fn(),
  getApiBase: () => "https://server.test",
}));
import { authFetch } from "@/lib/api";
import { useReorderSettingsModels } from "./settings";

const key = queryKeys.settings("/model-configs?admin=1");
const models: AdminModelConfig[] = ["first", "second", "image"].map(
  (id, index) => ({
    ...modelDraft(),
    id,
    label: id,
    model: id,
    updatedAt: 1,
    sortOrder: index,
    apiKey: "preserved-key",
    taskModel: false,
    catalogPricing: null,
    modelType: id === "image" ? "image" : "chat",
    enabled: id !== "second",
  }),
);
let client: QueryClient;
let root: Root;
let mutation: ReturnType<typeof useReorderSettingsModels>;
let respond: (response: Response) => void;
function Harness() {
  mutation = useReorderSettingsModels();
  return null;
}
function order() {
  return client
    .getQueryData<{ modelConfigs: AdminModelConfig[] }>(key)
    ?.modelConfigs.map((m) => m.id);
}
beforeEach(async () => {
  vi.clearAllMocks();
  const { window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  for (const [name, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    vi.stubGlobal(name, value);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(key, { modelConfigs: models });
  client.setQueryData(queryKeys.modelConfigs(), { models: [] });
  vi.mocked(authFetch).mockImplementation(
    () =>
      new Promise<Awaited<ReturnType<typeof authFetch>>>((resolve) => {
        respond = (response) =>
          resolve(response as unknown as Awaited<ReturnType<typeof authFetch>>);
      }),
  );
  root = createRoot(
    window.document.getElementById("root") as unknown as HTMLElement,
  );
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  // Query notifications are scheduled; drain them before removing the DOM globals.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});
async function start() {
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = mutation.mutateAsync(["second", "first", "image"]);
    await vi.waitFor(() => expect(authFetch).toHaveBeenCalledOnce());
  });
  return { pending };
}

it("moves optimistically, sends every model ID, and refreshes both model lists", async () => {
  const { pending } = await start();
  expect(order()).toEqual(["second", "first", "image"]);
  const request = vi.mocked(authFetch).mock.calls[0];
  expect(request[0]).toBe("https://server.test/api/model-configs/order");
  expect(request[1]?.method).toBe("PUT");
  expect(JSON.parse(request[1]?.body as string)).toEqual({
    modelIds: ["second", "first", "image"],
  });
  expect(
    client.getQueryData<{ modelConfigs: AdminModelConfig[] }>(key)
      ?.modelConfigs[0],
  ).toMatchObject({ apiKey: "preserved-key", enabled: false, sortOrder: 0 });
  await act(async () => {
    respond(Response.json({ modelIds: ["second", "first", "image"] }));
    await pending;
  });
  expect(order()).toEqual(["second", "first", "image"]);
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.modelConfigs())?.isInvalidated).toBe(
    true,
  );
});

it("restores the previous order and refreshes after a conflict without retrying the write", async () => {
  const { pending } = await start();
  await act(async () => {
    const failed = expect(pending).rejects.toThrow();
    respond(
      Response.json(
        { error: "The model list changed. Refresh and try again." },
        { status: 409 },
      ),
    );
    await failed;
  });
  expect(order()).toEqual(["first", "second", "image"]);
  expect(client.getQueryData(key)).toEqual({ modelConfigs: models });
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(authFetch).toHaveBeenCalledOnce();
});

it("does not restore admin data after its cache has been cleared", async () => {
  const { pending } = await start();
  client.removeQueries({ queryKey: key });
  await act(async () => {
    const failed = expect(pending).rejects.toThrow();
    respond(Response.json({ error: "Unavailable" }, { status: 503 }));
    await failed;
  });
  expect(client.getQueryData(key)).toBeUndefined();
});
