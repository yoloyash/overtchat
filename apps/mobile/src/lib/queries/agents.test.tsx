import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentSessionStream } from "@/lib/agents/stream";
import { snapshot } from "@/lib/agents/test-fixtures";
import { queryKeys } from "./keys";
import { useAgentSession, useAgentConnections } from "./agents";

type StreamOptions = ConstructorParameters<typeof AgentSessionStream>[0];
const mocks = vi.hoisted(() => ({
  options: undefined as StreamOptions | undefined,
  foreground: true,
  start: vi.fn(),
  stop: vi.fn(),
  reconnect: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return mocks.foreground ? "active" : "background";
    },
    addEventListener: () => ({ remove: vi.fn() }),
  },
}));
vi.mock("expo-router/react-navigation", () => ({ useIsFocused: () => true }));
vi.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://chat.example" }));
vi.mock("@/lib/agents/api", () => ({
  agentFetch: mocks.fetch,
  agentJson: mocks.fetch,
}));
vi.mock("@/lib/agents/stream", () => ({
  AgentSessionStream: class {
    constructor(options: StreamOptions) {
      mocks.options = options;
    }
    start = mocks.start;
    stop = mocks.stop;
    reconnect = mocks.reconnect;
  },
}));

let root: Root;
let container: HTMLElement;
let client: QueryClient;
let consoleError: ReturnType<typeof vi.spyOn>;
const key = queryKeys.agentSession("https://chat.example", "session");
function Probe() {
  const session = useAgentSession("session");
  return <div>{session.snapshot?.status ?? "empty"}</div>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.foreground = true;
  mocks.options = undefined;
  const { window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    vi.stubGlobal(key, value);
  container = window.document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
}
async function flushNotifications() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

it("observes stream replicas through real React Query without a missing-queryFn diagnostic or a competing fetch", async () => {
  await mount();
  expect(container.textContent).toBe("empty");
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(consoleError).not.toHaveBeenCalled();

  await act(async () =>
    mocks.options!.onReplica({
      snapshot: snapshot("running"),
      cursor: { epoch: "epoch", sequence: 1 },
    }),
  );
  await flushNotifications();
  expect(container.textContent).toBe("running");
  await act(async () => {
    await client.invalidateQueries({ queryKey: key });
    await client.refetchQueries({ queryKey: key });
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.fetchStatus).toBe("idle");
  expect(consoleError).not.toHaveBeenCalled();
});

it("renders an existing replica while backgrounded without fetching or opening a stream", async () => {
  mocks.foreground = false;
  client.setQueryData(key, {
    snapshot: snapshot(),
    cursor: { epoch: "epoch", sequence: 1 },
  });
  await mount();
  expect(container.textContent).toBe("idle");
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();
});

it("shows pull-to-refresh progress only for an explicit refresh", async () => {
  let connections!: ReturnType<typeof useAgentConnections>;
  function ConnectionsProbe() {
    connections = useAgentConnections();
    return null;
  }
  mocks.fetch.mockResolvedValue({ connections: [] });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ConnectionsProbe />
      </QueryClientProvider>,
    ),
  );
  await flushNotifications();
  let finish!: (value: unknown) => void;
  mocks.fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let request!: Promise<unknown>;
  await act(async () => {
    request = connections.refetch();
  });
  await flushNotifications();
  expect(connections.isFetching).toBe(true);
  expect(connections.refreshing).toBe(false);
  await act(async () => {
    finish({ connections: [] });
    await request;
  });
  await act(async () => {
    request = connections.refresh();
  });
  expect(connections.refreshing).toBe(true);
  await act(async () => {
    finish({ connections: [] });
    await request;
  });
  expect(connections.refreshing).toBe(false);
});
