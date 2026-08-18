import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentSession: vi.fn(),
  subscribeSession: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentSession: mocks.getOwnedAgentSession,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: { subscribeSession: mocks.subscribeSession },
}));

import { GET } from "./route";

const owned = {
  host: {
    connectorId: "connector",
    transport: "local",
    sshAlias: null,
    userId: "owner",
  },
  connection: {
    id: "connection",
    provider: "pi",
    shellMode: "interactive",
    executable: "pi",
    detectedVersion: "0.55.0",
  },
  workspace: { id: "workspace", path: "/workspace" },
  agentSession: {
    id: "session",
    providerSessionId: "provider-session",
    providerSessionPath: "/sessions/provider-session.jsonl",
  },
};

const sessionDescriptor = {
  connectionId: "connection",
  workspaceId: "workspace",
  provider: "pi",
  target: { transport: "local", shellMode: "interactive" },
  executable: "pi",
  cwd: "/workspace",
  detectedVersion: "0.55.0",
  sessionId: "session",
  providerSessionId: "provider-session",
  providerSessionPath: "/sessions/provider-session.jsonl",
  launchConfig: {},
};

const context = { params: Promise.resolve({ id: "session" }) };

describe("agent session event stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.getOwnedAgentSession.mockResolvedValue(owned);
    mocks.subscribeSession.mockImplementation(
      async (
        _connectorId: string,
        _session: unknown,
        after: { epoch: string; sequence: number } | undefined,
        listener: (event: Record<string, unknown>) => void,
      ) => {
        listener({
          epoch: "runtime",
          sequence: (after?.sequence ?? 0) + 1,
          type: "snapshot",
          data: { sessionId: "session", status: "idle" },
        });
        return { authoritative: false, unsubscribe: mocks.unsubscribe };
      },
    );
  });

  it("passes the runtime cursor into replay and emits valid SSE", async () => {
    const response = await GET(
      new Request("http://server.test/events", {
        headers: { "Last-Event-ID": "runtime:7" },
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(
      "text/event-stream",
    );
    const reader = response.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("id: runtime:8");
    expect(text).toContain("event: runtime");
    expect(mocks.subscribeSession).toHaveBeenCalledWith(
      "connector",
      sessionDescriptor,
      { epoch: "runtime", sequence: 7 },
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
    await reader.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });

  it("emits the connector-owned reconciliation before buffered live events", async () => {
    mocks.subscribeSession.mockImplementation(
      async (
        _connectorId: string,
        _session: unknown,
        _after: unknown,
        listener: (event: Record<string, unknown>) => void,
      ) => {
        listener({
          epoch: "runtime",
          sequence: 9,
          type: "runtime_event",
          data: { type: "turn_start" },
        });
        return {
          authoritative: true,
          sync: {
            reset: true,
            cursor: { epoch: "runtime", sequence: 8 },
            snapshot: { sessionId: "session", status: "idle" },
          },
          unsubscribe: mocks.unsubscribe,
        };
      },
    );

    const response = await GET(
      new Request("http://server.test/events?sync=1&after=runtime%3A7"),
      context,
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    const second = decoder.decode((await reader.read()).value);

    expect(first).toContain("event: sync");
    expect(first).toContain("id: runtime:8");
    expect(second).toContain("event: runtime");
    expect(second).toContain("id: runtime:9");
    await reader.cancel();
  });

  it("forwards an authoritative sync produced when the connector reconnects", async () => {
    let synchronize:
      | ((sync: {
          reset: true;
          cursor: { epoch: string; sequence: number };
          snapshot: Record<string, unknown>;
        }) => void)
      | undefined;
    mocks.subscribeSession.mockImplementation(
      async (
        _connectorId: string,
        _session: unknown,
        _after: unknown,
        _listener: unknown,
        onSync: typeof synchronize,
      ) => {
        synchronize = onSync;
        return { authoritative: true, unsubscribe: mocks.unsubscribe };
      },
    );
    const response = await GET(
      new Request("http://server.test/events?sync=1&after=runtime%3A9"),
      context,
    );
    const reader = response.body!.getReader();

    synchronize?.({
      reset: true,
      cursor: { epoch: "restarted-runtime", sequence: 2 },
      snapshot: { sessionId: "session", status: "running" },
    });
    const event = new TextDecoder().decode((await reader.read()).value);

    expect(event).toContain("event: sync");
    expect(event).toContain("id: restarted-runtime:2");
    await reader.cancel();
  });

  it("keeps a legacy connector stream explicit for opted-in browsers", async () => {
    const response = await GET(
      new Request("http://server.test/events?sync=1"),
      context,
    );
    const reader = response.body!.getReader();
    const event = new TextDecoder().decode((await reader.read()).value);

    expect(event).toContain("event: legacy-runtime");
    expect(event).toContain("id: runtime:1");
    await reader.cancel();
  });

  it("translates authoritative sync into runtime frames for old browsers", async () => {
    let synchronize:
      | ((sync: {
          reset: false;
          cursor: { epoch: string; sequence: number };
          events: Array<Record<string, unknown>>;
        }) => void)
      | undefined;
    mocks.subscribeSession.mockImplementation(
      async (
        _connectorId: string,
        _session: unknown,
        _after: unknown,
        _listener: unknown,
        onSync: typeof synchronize,
      ) => {
        synchronize = onSync;
        return {
          authoritative: true,
          sync: {
            reset: true,
            cursor: { epoch: "runtime", sequence: 0 },
            snapshot: { sessionId: "session", status: "idle" },
          },
          unsubscribe: mocks.unsubscribe,
        };
      },
    );
    const response = await GET(
      new Request("http://server.test/events"),
      context,
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const initial = decoder.decode((await reader.read()).value);

    expect(initial).toContain("event: runtime");
    expect(initial).toContain("id: runtime:0");
    expect(initial).not.toContain("event: sync");

    synchronize?.({
      reset: false,
      cursor: { epoch: "runtime", sequence: 2 },
      events: [
        {
          epoch: "runtime",
          sequence: 1,
          type: "runtime_event",
          data: { type: "turn_start" },
        },
        {
          epoch: "runtime",
          sequence: 2,
          type: "runtime_event",
          data: { type: "turn_end" },
        },
      ],
    });
    const firstSuffix = decoder.decode((await reader.read()).value);
    const secondSuffix = decoder.decode((await reader.read()).value);
    expect(firstSuffix).toContain("event: runtime");
    expect(firstSuffix).toContain("id: runtime:1");
    expect(secondSuffix).toContain("id: runtime:2");
    await reader.cancel();
  });

  it("releases a connector subscription when the request aborts while subscribing", async () => {
    let resolveSubscription!: (value: {
      authoritative: boolean;
      unsubscribe: () => void;
    }) => void;
    mocks.subscribeSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubscription = resolve;
        }),
    );
    const abort = new AbortController();
    const responsePending = GET(
      new Request("http://server.test/events?sync=1", {
        signal: abort.signal,
      }),
      context,
    );
    await vi.waitFor(() => expect(mocks.subscribeSession).toHaveBeenCalled());

    abort.abort();
    resolveSubscription({
      authoritative: true,
      unsubscribe: mocks.unsubscribe,
    });

    const response = await responsePending;
    expect(response.status).toBe(204);
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not subscribe to a session owned by another user", async () => {
    mocks.getOwnedAgentSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://server.test/events"),
      context,
    );

    expect(response.status).toBe(404);
    expect(mocks.subscribeSession).not.toHaveBeenCalled();
  });
});
