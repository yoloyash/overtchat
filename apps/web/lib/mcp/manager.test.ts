import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import type { McpServerRow } from "@/lib/db/mcpServers";
import { McpManager } from "./manager";
import { McpConnection, mcpConnectionRevision } from "./runtime";

function server(): McpServerRow {
  return {
    id: "reference",
    name: "Reference",
    availability: "everyone",
    config: {
      transport: "http",
      url: "https://reference.example.test/mcp",
      headers: {},
    },
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function factory() {
  const clients: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const connect = vi.fn(async (value: McpServerRow) => {
    const client = { close: vi.fn().mockResolvedValue(undefined) };
    clients.push(client);
    return new McpConnection(
      mcpConnectionRevision(value),
      client as unknown as MCPClient,
      { echo: { description: "echo" } } as unknown as ToolSet,
      { connected: true },
    );
  });
  return { connect, clients };
}

describe("MCP manager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares a runtime across turns in one chat but isolates different chats", async () => {
    const created = factory();
    const manager = new McpManager({ connect: created.connect });
    const firstScope = { userId: "user", chatId: "first" };
    const secondScope = { userId: "user", chatId: "second" };

    const first = await manager.acquire(firstScope, [server()]);
    await first.release();
    const repeated = await manager.acquire(firstScope, [server()]);
    await repeated.release();
    const isolated = await manager.acquire(secondScope, [server()]);
    await isolated.release();

    expect(created.connect).toHaveBeenCalledTimes(2);
    await manager.closeAll();
  });

  it("uses both the user and chat as the isolation boundary", async () => {
    const created = factory();
    const manager = new McpManager({ connect: created.connect });

    const first = await manager.acquire(
      { userId: "first-user", chatId: "shared-chat-id" },
      [server()],
    );
    await first.release();
    const second = await manager.acquire(
      { userId: "second-user", chatId: "shared-chat-id" },
      [server()],
    );
    await second.release();

    expect(created.connect).toHaveBeenCalledTimes(2);
    await manager.closeAll();
  });

  it("closes an idle chat runtime after its retention window", async () => {
    vi.useFakeTimers();
    const created = factory();
    const manager = new McpManager({
      connect: created.connect,
      idleTimeoutMs: 1_000,
    });
    const binding = await manager.acquire(
      { userId: "user", chatId: "chat" },
      [server()],
    );
    await binding.release();

    await vi.advanceTimersByTimeAsync(999);
    expect(created.clients[0]?.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(created.clients[0]?.close).toHaveBeenCalledOnce();
    });
  });

  it("does not expire a runtime while a binding is active", async () => {
    vi.useFakeTimers();
    const created = factory();
    const manager = new McpManager({
      connect: created.connect,
      idleTimeoutMs: 1_000,
    });
    const binding = await manager.acquire(
      { userId: "user", chatId: "chat" },
      [server()],
    );

    await vi.advanceTimersByTimeAsync(2_000);
    expect(created.clients[0]?.close).not.toHaveBeenCalled();
    await binding.release();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => {
      expect(created.clients[0]?.close).toHaveBeenCalledOnce();
    });
  });

  it("closes only the deleted conversation runtime", async () => {
    const created = factory();
    const manager = new McpManager({ connect: created.connect });
    const firstScope = { userId: "user", chatId: "first" };
    const secondScope = { userId: "user", chatId: "second" };
    const first = await manager.acquire(firstScope, [server()]);
    await first.release();
    const second = await manager.acquire(secondScope, [server()]);
    await second.release();

    await manager.closeScope(firstScope);
    expect(created.clients[0]?.close).toHaveBeenCalledOnce();
    expect(created.clients[1]?.close).not.toHaveBeenCalled();

    await manager.closeAll();
  });

  it("invalidates a personal preference only across that user's chats", async () => {
    const created = factory();
    const manager = new McpManager({ connect: created.connect });
    const first = await manager.acquire(
      { userId: "first-user", chatId: "first-chat" },
      [server()],
    );
    await first.release();
    const second = await manager.acquire(
      { userId: "first-user", chatId: "second-chat" },
      [server()],
    );
    await second.release();
    const otherUser = await manager.acquire(
      { userId: "other-user", chatId: "chat" },
      [server()],
    );
    await otherUser.release();

    await manager.invalidateUserServer("first-user", "reference");

    expect(created.clients[0]?.close).toHaveBeenCalledOnce();
    expect(created.clients[1]?.close).toHaveBeenCalledOnce();
    expect(created.clients[2]?.close).not.toHaveBeenCalled();
    await manager.closeAll();
  });
});
