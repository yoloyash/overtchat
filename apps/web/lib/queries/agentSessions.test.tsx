import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import type {
  AgentRuntimeSnapshot,
  AgentSessionCommand,
} from "@overtchat/agent-bridge";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  useAgentSession,
  useAgentSessionCommand,
} from "./agentSessions";
import { agentSessionKeys } from "./keys";
import type { AgentSessionReplica } from "@/lib/agents/sessionReplica";

function snapshot(sessionId = "session") {
  return {
    sessionId,
    provider: "codex",
    capabilities: { steer: true },
    status: "idle",
    activeTurn: null,
    state: {},
    messages: [],
    models: [],
    thinkingLevels: [],
    commands: [],
    stats: {
      sessionFile: null,
      sessionId: null,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      tokens: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
      cost: 0,
    },
    queuedMessages: [],
  } satisfies AgentRuntimeSnapshot;
}

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  close = vi.fn();
}

function Probe({
  sessionId,
  onMount,
}: {
  sessionId: string;
  onMount: () => void;
}) {
  const session = useAgentSession(sessionId);
  useEffect(() => {
    onMount();
  }, [onMount]);
  return (
    <div data-testid="session">
      {session.data?.sessionId ?? session.error?.message ?? "pending"}
    </div>
  );
}

function StreamStatusProbe({ sessionId }: { sessionId: string }) {
  const session = useAgentSession(sessionId);
  return <div data-testid="stream-status">{session.streamStatus}</div>;
}

function CommandProbe({
  onReady,
}: {
  onReady: (run: (command: AgentSessionCommand) => Promise<unknown>) => void;
}) {
  const command = useAgentSessionCommand("session");
  useEffect(() => {
    onReady(command.mutateAsync);
  }, [command.mutateAsync, onReady]);
  return null;
}

describe("useAgentSession", () => {
  let container: HTMLElement;
  let root: Root;
  let queryClient: QueryClient;
  const originalGlobals = new Map<
    PropertyKey,
    PropertyDescriptor | undefined
  >();

  beforeEach(() => {
    vi.useFakeTimers();
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
      defaultOptions: { queries: { gcTime: Infinity } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
    originalGlobals.clear();
  });

  it("recovers an initially offline session and starts streaming without a remount", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: "The OvertChat Host Connector is offline." },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ snapshot: snapshot() }));
    vi.stubGlobal("fetch", fetchMock);
    const onMount = vi.fn();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe sessionId="session" onMount={onMount} />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("offline");
    expect(FakeEventSource.instances).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData<AgentSessionReplica>(
        agentSessionKeys.detail("session"),
      )?.snapshot.sessionId,
    ).toBe("session");
    expect(container.textContent).toBe("session");
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe(
      "/api/agent-sessions/session/events?sync=1",
    );
  });

  it("stays reconnecting until the replacement event stream opens", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ snapshot: snapshot() }))
      .mockResolvedValueOnce(Response.json({ snapshot: snapshot() }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <StreamStatusProbe sessionId="session" />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
    });

    const initial = FakeEventSource.instances[0];
    expect(initial).toBeDefined();
    await act(async () => initial?.onopen?.(new Event("open")));
    expect(container.textContent).toBe("connected");

    await act(async () => {
      initial?.onerror?.(new Event("error"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(initial?.close).toHaveBeenCalledOnce();
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(container.textContent).toBe("reconnecting");

    await act(async () => {
      FakeEventSource.instances[1]?.onopen?.(new Event("open"));
    });
    expect(container.textContent).toBe("connected");
  });

  it.each([401, 403, 404])(
    "does not retry a non-recoverable HTTP %s response",
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: "No access" }, { status }));
      vi.stubGlobal("fetch", fetchMock);

      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe sessionId="session" onMount={() => undefined} />
          </QueryClientProvider>,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(FakeEventSource.instances).toHaveLength(0);
    },
  );

  it("reuses a submission identity after an unknown outcome", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (bodies.length === 1) {
          throw new TypeError("connection reset after upload");
        }
        return Response.json({ accepted: true });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    let mutate: (command: AgentSessionCommand) => Promise<unknown> = () =>
      Promise.reject(new Error("Command mutation is not ready."));
    const onReady = vi.fn(
      (run: (command: AgentSessionCommand) => Promise<unknown>) => {
        mutate = run;
      },
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommandProbe onReady={onReady} />
        </QueryClientProvider>,
      );
    });
    expect(onReady).toHaveBeenCalledOnce();
    const run = mutate;
    const unchanged: AgentSessionCommand = {
      type: "prompt",
      message: "Inspect this",
      images: [
        {
          uploadId: "11111111-1111-4111-8111-111111111111",
          filename: "first.png",
          mediaType: "image/png",
        },
        {
          uploadId: "22222222-2222-4222-8222-222222222222",
          filename: "second.png",
          mediaType: "image/png",
        },
      ],
    };

    await expect(run(unchanged)).rejects.toThrow(
      "command outcome is unknown",
    );
    await expect(run(unchanged)).resolves.toEqual({ accepted: true });
    await expect(
      run({ ...unchanged, message: "Inspect something else" }),
    ).resolves.toEqual({ accepted: true });

    expect(bodies).toHaveLength(3);
    expect(bodies[0]?.clientMessageId).toBe(bodies[1]?.clientMessageId);
    expect(bodies[2]?.clientMessageId).not.toBe(
      bodies[1]?.clientMessageId,
    );
    expect(bodies[0]?.images).toEqual(unchanged.images);
  });
});
