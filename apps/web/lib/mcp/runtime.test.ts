import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import type { McpServerRow } from "@/lib/db/mcpServers";
import {
  McpConnection,
  McpRuntime,
  mcpConnectionRevision,
} from "./runtime";

function server(
  id: string,
  name = id,
  updatedAt = new Date(0),
): McpServerRow {
  return {
    id,
    name,
    availability: "everyone",
    config: {
      transport: "http",
      url: `https://${id}.example.test/mcp`,
      headers: {},
    },
    createdAt: new Date(0),
    updatedAt,
  };
}

function connection(value: McpServerRow, toolName = "echo") {
  const close = vi.fn().mockResolvedValue(undefined);
  const state = { connected: true };
  const rawTools = {
    [toolName]: { description: `${value.name} ${toolName}` },
  } as unknown as ToolSet;
  return {
    value: new McpConnection(
      mcpConnectionRevision(value),
      { close } as unknown as MCPClient,
      rawTools,
      state,
    ),
    close,
    state,
  };
}

describe("conversation MCP runtime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts each server once and reuses its tools across turns", async () => {
    const connected = connection(server("reference", "Reference"));
    const connect = vi.fn().mockResolvedValue(connected.value);
    const runtime = new McpRuntime(connect);

    const first = await runtime.acquire([server("reference", "Reference")]);
    await first.release();
    const second = await runtime.acquire([server("reference", "Reference")]);

    expect(connect).toHaveBeenCalledOnce();
    expect(second.tools).toEqual(first.tools);
    expect(connected.close).not.toHaveBeenCalled();

    await second.release();
    await runtime.close();
    expect(connected.close).toHaveBeenCalledOnce();
  });

  it("publishes changed configuration without interrupting an in-flight binding", async () => {
    const originalServer = server("reference", "Reference", new Date(1));
    const replacementServer = server(
      "reference",
      "Renamed Reference",
      new Date(2),
    );
    replacementServer.config = {
      transport: "http",
      url: "https://replacement.example.test/mcp",
      headers: {},
    };
    const original = connection(originalServer);
    const replacement = connection(replacementServer);
    const connect = vi
      .fn()
      .mockResolvedValueOnce(original.value)
      .mockResolvedValueOnce(replacement.value);
    const runtime = new McpRuntime(connect);

    const oldBinding = await runtime.acquire([originalServer]);
    const newBinding = await runtime.acquire([replacementServer]);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(original.close).not.toHaveBeenCalled();
    expect(replacement.close).not.toHaveBeenCalled();

    await oldBinding.release();
    expect(original.close).toHaveBeenCalledOnce();
    expect(replacement.close).not.toHaveBeenCalled();

    await newBinding.release();
    await runtime.close();
    expect(replacement.close).toHaveBeenCalledOnce();
  });

  it("reuses unchanged servers when another server changes", async () => {
    const stableServer = server("stable", "Stable");
    const oldChangingServer = server("changing", "Changing", new Date(1));
    const newChangingServer = server("changing", "Changed", new Date(2));
    newChangingServer.config = {
      transport: "http",
      url: "https://changed.example.test/mcp",
      headers: {},
    };
    const stable = connection(stableServer);
    const oldChanging = connection(oldChangingServer);
    const newChanging = connection(newChangingServer);
    const connect = vi.fn(async (value: McpServerRow) => {
      if (value.id === "stable") return stable.value;
      return value.updatedAt.getTime() === 1
        ? oldChanging.value
        : newChanging.value;
    });
    const runtime = new McpRuntime(connect);

    const first = await runtime.acquire([stableServer, oldChangingServer]);
    await first.release();
    const second = await runtime.acquire([stableServer, newChangingServer]);

    expect(connect).toHaveBeenCalledTimes(3);
    expect(stable.close).not.toHaveBeenCalled();
    expect(oldChanging.close).toHaveBeenCalledOnce();

    await second.release();
    await runtime.close();
  });

  it("reprojects a renamed server without restarting its connection", async () => {
    const originalServer = server("reference", "Original", new Date(1));
    const renamedServer = server("reference", "Renamed", new Date(2));
    const connected = connection(originalServer);
    const connect = vi.fn().mockResolvedValue(connected.value);
    const runtime = new McpRuntime(connect);

    const first = await runtime.acquire([originalServer]);
    await first.release();
    const second = await runtime.acquire([renamedServer]);

    expect(connect).toHaveBeenCalledOnce();
    expect(Object.keys(first.tools)).toEqual(["mcp__Original__echo"]);
    expect(Object.keys(second.tools)).toEqual(["mcp__Renamed__echo"]);
    expect(connected.close).not.toHaveBeenCalled();

    await second.release();
    await runtime.close();
  });

  it("isolates startup failures and retries only failed servers", async () => {
    const offlineServer = server("offline", "Offline");
    const healthyServer = server("healthy", "Healthy");
    const recovered = connection(offlineServer);
    const healthy = connection(healthyServer);
    let offlineAttempts = 0;
    const connect = vi.fn(async (value: McpServerRow) => {
      if (value.id === "healthy") return healthy.value;
      offlineAttempts += 1;
      if (offlineAttempts === 1) throw new Error("offline");
      return recovered.value;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = new McpRuntime(connect);

    const first = await runtime.acquire([offlineServer, healthyServer]);
    expect(Object.keys(first.tools)).toHaveLength(1);
    await first.release();

    const second = await runtime.acquire([offlineServer, healthyServer]);
    expect(Object.keys(second.tools)).toHaveLength(2);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(healthy.close).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();

    await second.release();
    await runtime.close();
  });

  it("reconnects a transport that disconnected between turns", async () => {
    const value = server("reference", "Reference");
    const disconnected = connection(value);
    const replacement = connection(value);
    const connect = vi
      .fn()
      .mockResolvedValueOnce(disconnected.value)
      .mockResolvedValueOnce(replacement.value);
    const runtime = new McpRuntime(connect);

    const first = await runtime.acquire([value]);
    await first.release();
    disconnected.state.connected = false;
    const second = await runtime.acquire([value]);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(disconnected.close).toHaveBeenCalledOnce();
    await second.release();
    await runtime.close();
  });

  it("drains an invalidated connection after its active binding finishes", async () => {
    const value = server("reference", "Reference");
    const connected = connection(value);
    const replacement = connection(value);
    const connect = vi
      .fn()
      .mockResolvedValueOnce(connected.value)
      .mockResolvedValueOnce(replacement.value);
    const runtime = new McpRuntime(connect);

    const binding = await runtime.acquire([value]);
    await runtime.invalidate(value.id);
    expect(connected.close).not.toHaveBeenCalled();

    await binding.release();
    expect(connected.close).toHaveBeenCalledOnce();

    const next = await runtime.acquire([value]);
    expect(connect).toHaveBeenCalledTimes(2);
    await next.release();
    await runtime.close();
  });

  it("keeps leased connections alive when the conversation closes", async () => {
    const connected = connection(server("reference", "Reference"));
    const runtime = new McpRuntime(vi.fn().mockResolvedValue(connected.value));
    const binding = await runtime.acquire([server("reference", "Reference")]);

    await runtime.close();
    expect(connected.close).not.toHaveBeenCalled();

    await binding.release();
    expect(connected.close).toHaveBeenCalledOnce();
  });
});
