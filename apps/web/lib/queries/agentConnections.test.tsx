import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAgentConnectionSessionDirectory,
  useAgentConnections,
} from "./agentConnections";
import { agentConnectionKeys } from "./keys";

const connections: AgentConnectionListItem[] = [
  {
    id: "connection",
    provider: "codex",
    executable: "codex",
    detectedVersion: null,
    lastValidatedAt: null,
    host: {
      id: "host",
      connectorId: "connector",
      name: "This machine",
      transport: "local",
      sshAlias: null,
    },
    workspaces: [
      {
        id: "workspace",
        path: "/workspace",
        name: "workspace",
        sessions: [
          {
            id: "session",
            providerSessionId: "provider-session",
            name: "Session",
            firstMessage: null,
            messageCount: 0,
            createdAt: null,
            modifiedAt: null,
            runtimeStatus: "idle",
          },
        ],
      },
    ],
  },
];

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data: string) {
    const event = new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close = vi.fn();
}

function Probe() {
  const query = useAgentConnections();
  useAgentConnectionSessionDirectory(query.data ?? []);
  return <div>{query.data?.[0]?.workspaces[0]?.sessions[0]?.runtimeStatus}</div>;
}

describe("agent connection session directory", () => {
  let container: HTMLElement;
  let root: Root;
  let queryClient: QueryClient;
  const originalGlobals = new Map<
    PropertyKey,
    PropertyDescriptor | undefined
  >();

  beforeEach(() => {
    const { window } = parseHTML(
      "<!doctype html><html><body><div id=\"root\"></div></body></html>",
    );
    for (const [key, value] of Object.entries({
      window,
      document: window.document,
      navigator: window.navigator,
      HTMLElement: window.HTMLElement,
      Event: window.Event,
      MessageEvent: window.MessageEvent,
      EventSource: FakeEventSource,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    FakeEventSource.instances = [];
    container = window.document.getElementById("root") as HTMLElement;
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: Infinity, retry: false, staleTime: Infinity },
      },
    });
    queryClient.setQueryData(agentConnectionKeys.list(), connections);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ connections }),
      ),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    vi.restoreAllMocks();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
    originalGlobals.clear();
  });

  it("applies the global snapshot and later session upserts", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toBe("idle");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe(
      "/api/agent-connections/events",
    );

    await act(async () => {
      FakeEventSource.instances[0]!.emit(
        "snapshot",
        JSON.stringify({
          sessions: [
            { sessionId: "session", runtimeStatus: "exited" },
          ],
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toBe("exited");

    await act(async () => {
      FakeEventSource.instances[0]!.emit(
        "update",
        JSON.stringify({
          sessionId: "session",
          runtimeStatus: "running",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toBe("running");
    expect(
      queryClient.getQueryData<AgentConnectionListItem[]>(
        agentConnectionKeys.list(),
      )?.[0]?.workspaces[0]?.sessions[0]?.runtimeStatus,
    ).toBe("running");
  });
});
