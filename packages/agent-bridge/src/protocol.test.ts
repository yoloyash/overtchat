import { describe, expect, it } from "vitest";
import {
  HOST_CONNECTOR_CAPABILITIES,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  isHostConnectorCommand,
  isAgentRuntimeEnvelope,
  isAgentSessionSync,
  isAgentSessionDirectoryEntry,
  isHostConnectorEvent,
  isAgentWorkspaceGitBranches,
  isAgentWorkspaceGitSwitchResult,
  isAgentWorkspaceGitWorktree,
  isAgentWorkspaceGitWorktreeInspection,
  parseHostConnectorCapabilities,
} from "./index";
import { agentProviderCatalogSchema } from "./agents";

describe("Host Connector protocol compatibility", () => {
  it.each([undefined, "responding", "waiting"])("accepts the retired response phase %s from older connectors and journals", (phase) => {
    const snapshot = { sessionId: "session", status: "running", activeTurn: { startedAt: 123, phase } };
    expect(isAgentRuntimeEnvelope({ epoch: "epoch", sequence: 1, type: "snapshot", data: snapshot })).toBe(true);
    expect(isAgentSessionSync({ reset: true, cursor: { epoch: "epoch", sequence: 1 }, snapshot })).toBe(true);
    expect(isAgentSessionDirectoryEntry({ sessionId: "session", runtimeStatus: "running", responsePhase: phase })).toBe(true);
    expect(isAgentRuntimeEnvelope({ epoch: "epoch", sequence: 1, type: "runtime_event", data: { type: "overtchat_status", status: "running", phase } })).toBe(true);
  });

  it("identifies the current wire protocol", () => {
    expect(HOST_CONNECTOR_PROTOCOL_VERSION).toBe(6);
  });

  it("selects known capabilities and ignores unknown additive tokens", () => {
    expect(
      parseHostConnectorCapabilities(
        ` ${HOST_CONNECTOR_CAPABILITIES[0]},future-capability,${HOST_CONNECTOR_CAPABILITIES[0]} `,
      ),
    ).toEqual([HOST_CONNECTOR_CAPABILITIES[0]]);
    expect(
      parseHostConnectorCapabilities(HOST_CONNECTOR_CAPABILITIES.join(",")),
    ).toEqual(HOST_CONNECTOR_CAPABILITIES);
    expect(parseHostConnectorCapabilities(null)).toEqual([]);
  });

  it("accepts optional server information on the legacy sync command", () => {
    expect(
      isHostConnectorCommand({
        type: "sync",
        connectionEpoch: "connection",
        activeSessionIds: [],
        serverInfo: {
          protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
          capabilities: [...HOST_CONNECTOR_CAPABILITIES, "future-capability"],
        },
      }),
    ).toBe(true);
    expect(
      isHostConnectorCommand({
        type: "sync",
        connectionEpoch: "connection",
        activeSessionIds: [],
      }),
    ).toBe(true);
  });

  it("validates provider-neutral workspace file requests", () => {
    for (const type of [
      "list_workspace_directory",
      "read_workspace_file",
    ] as const) {
      expect(
        isHostConnectorCommand({
          type: "request",
          requestId: "request",
          request: {
            type,
            target: { transport: "ssh", alias: "workstation" },
            root: "/srv/project",
            path: "apps/web",
          },
        }),
      ).toBe(true);
    }
  });

  it("validates Git branch requests and results", () => {
    const request = (value: Record<string, unknown>) =>
      isHostConnectorCommand({ type: "request", requestId: "request", request: value });
    const target = { transport: "ssh", alias: "workstation" };
    expect(request({ type: "list_git_branches", target, path: "/srv/project" })).toBe(true);
    expect(request({ type: "list_git_branches", target, path: "" })).toBe(false);
    for (const branch of [
      { kind: "local", name: "feature/one" },
      { kind: "new", name: "topic" },
      { kind: "remote", remote: "origin", name: "main" },
    ]) {
      expect(
        request({ type: "switch_git_branch", target, path: "/srv/project", branch, stash: false }),
      ).toBe(true);
    }
    for (const branch of [
      { kind: "local", name: "--orphan" },
      { kind: "local", name: "bad\nname" },
      { kind: "local", name: "" },
      { kind: "remote", name: "main" },
      { kind: "local", name: "main", remote: "origin" },
      { kind: "tag", name: "v1" },
    ]) {
      expect(
        request({ type: "switch_git_branch", target, path: "/srv/project", branch, stash: false }),
      ).toBe(false);
    }
    expect(
      request({
        type: "switch_git_branch",
        target,
        path: "/srv/project",
        branch: { kind: "local", name: "main" },
      }),
    ).toBe(false);

    expect(
      isAgentWorkspaceGitBranches({
        isGit: true,
        current: "main",
        truncated: false,
        branches: [
          { name: "main", remote: null, current: true, worktreePath: null, committedAt: 1 },
          { name: "next", remote: "origin", current: false, worktreePath: null, committedAt: null },
        ],
      }),
    ).toBe(true);
    expect(
      isAgentWorkspaceGitBranches({ isGit: true, current: null, truncated: false, branches: [{ name: "" }] }),
    ).toBe(false);
    expect(
      isAgentWorkspaceGitSwitchResult({
        status: "switched",
        branch: "main",
        stashed: true,
        restored: false,
        keptStash: "stash@{0}",
      }),
    ).toBe(true);
    expect(isAgentWorkspaceGitSwitchResult({ status: "changes_present", changedFiles: 3 })).toBe(true);
    expect(isAgentWorkspaceGitSwitchResult({ status: "agent_running" })).toBe(true);
    expect(isAgentWorkspaceGitSwitchResult({ status: "switched", branch: "main" })).toBe(false);
  });

  it("validates Git worktree requests and results", () => {
    const request = (value: Record<string, unknown>) =>
      isHostConnectorCommand({ type: "request", requestId: "request", request: value });
    const target = { transport: "local" };
    const create = (base: unknown, branch: unknown = "topic") =>
      request({ type: "create_git_worktree", target, path: "/srv/project", base, branch });
    expect(create({ kind: "local", name: "main" })).toBe(true);
    expect(create({ kind: "remote", remote: "origin", name: "main" })).toBe(true);
    expect(create({ kind: "new", name: "main" })).toBe(false);
    expect(create({ kind: "local", name: "main" }, "-b")).toBe(false);
    expect(create({ kind: "local", name: "main" }, "")).toBe(false);
    for (const type of ["inspect_git_worktree", "remove_git_worktree"]) {
      expect(request({ type, target, path: "/wt/topic" })).toBe(true);
      expect(request({ type, target, path: "" })).toBe(false);
    }

    expect(
      isAgentWorkspaceGitWorktree({
        path: "/wt/topic/app",
        worktreePath: "/wt/topic",
        name: "topic",
        branch: "topic",
      }),
    ).toBe(true);
    expect(isAgentWorkspaceGitWorktree({ path: "/wt/topic", name: "topic" })).toBe(false);
    expect(
      isAgentWorkspaceGitWorktreeInspection({
        exists: true,
        worktreePath: "/wt/topic",
        branch: null,
        changedFiles: 2,
      }),
    ).toBe(true);
    expect(
      isAgentWorkspaceGitWorktreeInspection({
        exists: false,
        worktreePath: null,
        branch: null,
        changedFiles: -1,
      }),
    ).toBe(false);
  });

  it("accepts a session-directory snapshot and provider-independent upserts", () => {
    expect(
      isHostConnectorEvent({
        sequence: 1,
        payload: {
          type: "session_directory",
          sessions: [
            { sessionId: "session", runtimeStatus: "running" },
          ],
        },
      }),
    ).toBe(true);
    expect(
      isHostConnectorEvent({
        sequence: 2,
        payload: {
          type: "session_update",
          session: { sessionId: "session", runtimeStatus: "idle" },
        },
      }),
    ).toBe(true);
    expect(
      isHostConnectorEvent({
        sequence: 3,
        payload: {
          type: "session_directory",
          sessions: [
            { sessionId: "session", runtimeStatus: "idle" },
            { sessionId: "session", runtimeStatus: "running" },
          ],
        },
      }),
    ).toBe(false);
  });

  it("validates provider catalogs at the connector boundary", () => {
    const catalog = {
      provider: "omp",
      models: [
        {
          provider: "omp",
          id: "openai/gpt-5",
          label: "GPT-5",
          api: "openai-responses",
          baseUrl: "",
          reasoning: true,
          input: ["text"],
          contextWindow: null,
          maxTokens: null,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      modes: [{ id: "full", label: "Full Access", description: "Yolo" }],
      defaultModeId: "full",
    };
    expect(agentProviderCatalogSchema.safeParse(catalog).success).toBe(true);
    expect(
      agentProviderCatalogSchema.safeParse({
        ...catalog,
        models: [{ ...catalog.models[0], provider: "pi" }],
      }).success,
    ).toBe(false);
  });

  it("validates usage events, including explicit unknown context", () => {
    const envelope = (usage: unknown) => ({
      epoch: "runtime",
      sequence: 1,
      type: "runtime_event",
      data: { type: "usage_update", usage },
    });
    expect(isAgentRuntimeEnvelope(envelope({ contextUsage: null }))).toBe(true);
    expect(
      isAgentRuntimeEnvelope(
        envelope({
          contextUsage: { tokens: 0, contextWindow: 100000, percent: 0 },
        }),
      ),
    ).toBe(true);
    expect(
      isAgentRuntimeEnvelope(
        envelope({ contextUsage: { tokens: 12, contextWindow: 0, percent: 0 } }),
      ),
    ).toBe(false);
    expect(isAgentRuntimeEnvelope(envelope({ cost: Infinity }))).toBe(false);
    expect(isAgentRuntimeEnvelope(envelope({ tokens: { total: -1 } }))).toBe(
      false,
    );
  });
});
