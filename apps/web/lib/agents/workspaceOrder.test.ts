import { describe, expect, it } from "vitest";
import type { AgentWorkspaceGroup } from "./workspaces";
import {
  agentWorkspaceOrderStorageKey,
  orderAgentWorkspaces,
} from "./workspaceOrder";

function group(key: string): AgentWorkspaceGroup {
  return {
    key,
    name: key,
    path: `/srv/${key}`,
    targets: [],
    sessions: [],
    host: {
      id: "host",
      connectorId: "connector",
      name: "Local",
      transport: "local",
      sshAlias: null,
    },
  };
}

describe("device-local workspace ordering", () => {
  const groups = [group("alpha"), group("beta"), group("gamma")];
  const keys = (items: AgentWorkspaceGroup[]) => items.map((item) => item.key);

  it("keeps the default order until an order is saved", () => {
    for (const saved of [null, {}, "alpha", []]) {
      expect(keys(orderAgentWorkspaces(groups, saved))).toEqual([
        "alpha",
        "beta",
        "gamma",
      ]);
    }
  });

  it("ignores stale, duplicate, and invalid keys and appends new workspaces", () => {
    expect(
      keys(
        orderAgentWorkspaces(groups, [
          "gamma",
          "deleted",
          "gamma",
          1,
          null,
          "alpha",
        ]),
      ),
    ).toEqual(["gamma", "alpha", "beta"]);
    expect(keys(groups)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("keeps an existing group's position when providers or names change", () => {
    const updated = groups.map((item) => ({
      ...item,
      name: `Renamed ${item.name}`,
    }));
    expect(
      keys(orderAgentWorkspaces(updated, ["beta", "alpha", "gamma"])),
    ).toEqual(["beta", "alpha", "gamma"]);
  });

  it("scopes storage to the server and account, including bundled desktop origins", () => {
    const key = agentWorkspaceOrderStorageKey("user-a", "https://one.example");
    expect(key).not.toBe(
      agentWorkspaceOrderStorageKey("user-b", "https://one.example"),
    );
    expect(key).not.toBe(
      agentWorkspaceOrderStorageKey("user-a", "https://two.example"),
    );
  });
});
