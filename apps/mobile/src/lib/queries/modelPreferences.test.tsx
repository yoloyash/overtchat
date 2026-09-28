import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useModelPreferences, useSetModelFavorite } from "./modelPreferences";
import { queryKeys } from "./keys";
const request = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/auth/client", () => ({
  getAuthClient: () => ({
    useSession: () => ({ data: { user: { id: "user" } } }),
  }),
}));
vi.mock("@/lib/api", () => ({
  getApiBase: () => "https://chat.example",
  authFetch: request,
}));
let root: Root;
let client: QueryClient;
let favorite: ReturnType<typeof useSetModelFavorite>;
const key = queryKeys.modelPreferences("https://chat.example", "user");
function Probe() {
  useModelPreferences();
  const mutation = useSetModelFavorite();
  useEffect(() => {
    favorite = mutation;
  }, [mutation]);
  return null;
}
beforeEach(() => {
  request.mockReset();
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
  client.setQueryData(key, { favoriteModelIds: [] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});
it("does not let a delayed refresh overwrite a successful favorite save", async () => {
  let finishRefresh!: (response: Response) => void;
  request.mockImplementation((_url, init) =>
    init?.method === "PUT"
      ? Promise.resolve(Response.json({ favoriteModelIds: ["one"] }))
      : new Promise((resolve) => {
          finishRefresh = resolve;
        }),
  );
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => {
    await favorite.mutateAsync({ modelConfigId: "one", favorite: true });
  });
  expect(client.getQueryData(key)).toEqual({ favoriteModelIds: ["one"] });
  await act(async () => {
    finishRefresh(Response.json({ favoriteModelIds: [] }));
  });
  expect(client.getQueryData(key)).toEqual({ favoriteModelIds: ["one"] });
});
