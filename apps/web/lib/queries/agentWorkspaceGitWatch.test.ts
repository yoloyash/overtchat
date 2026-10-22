import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentWorkspaceGitWatchKey,
  clearAgentWorkspaceGitLive,
  isAgentWorkspaceGitLive,
  setAgentWorkspaceGitLive,
  subscribeAgentWorkspaceGitWatches,
  watchAgentWorkspaceGit,
} from "./agentWorkspaceGitWatch";

describe("agent workspace Git watch registry", () => {
  const releases: Array<() => void> = [];

  afterEach(() => {
    for (const release of releases.splice(0)) release();
    clearAgentWorkspaceGitLive();
  });

  it("keeps a sorted, reference-counted key of watched workspaces", () => {
    const listener = vi.fn();
    const stop = subscribeAgentWorkspaceGitWatches(listener);
    const firstB = watchAgentWorkspaceGit("b");
    const firstA = watchAgentWorkspaceGit("a");
    const secondB = watchAgentWorkspaceGit("b");
    releases.push(firstA, secondB);

    expect(agentWorkspaceGitWatchKey()).toBe("a,b");
    firstB();
    expect(agentWorkspaceGitWatchKey()).toBe("a,b");
    secondB();
    secondB();
    expect(agentWorkspaceGitWatchKey()).toBe("a");
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
  });

  it("only marks watched workspaces live and forgets released ones", () => {
    setAgentWorkspaceGitLive("unwatched", true);
    expect(isAgentWorkspaceGitLive("unwatched")).toBe(false);

    const release = watchAgentWorkspaceGit("workspace");
    setAgentWorkspaceGitLive("workspace", true);
    expect(isAgentWorkspaceGitLive("workspace")).toBe(true);
    release();
    expect(isAgentWorkspaceGitLive("workspace")).toBe(false);
  });

  it("drops every live flag when the stream is interrupted", () => {
    releases.push(watchAgentWorkspaceGit("a"), watchAgentWorkspaceGit("b"));
    setAgentWorkspaceGitLive("a", true);
    setAgentWorkspaceGitLive("b", true);

    clearAgentWorkspaceGitLive();

    expect(isAgentWorkspaceGitLive("a")).toBe(false);
    expect(isAgentWorkspaceGitLive("b")).toBe(false);
  });
});
