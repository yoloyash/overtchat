import type { AgentWorkspaceGitStatus } from "@overtchat/agent-bridge";
import {
  inspectAgentWorkspaceGitStatus,
  type HostTarget,
} from "@overtchat/agent-runtime";

// Every open client polls each visible workspace independently. One inspection
// per workspace is shared by all callers that arrive while it runs or shortly
// after it finishes.
const STATUS_REUSE_MS = 1_500;

type CachedStatus = {
  status: AgentWorkspaceGitStatus;
  settledAt: number;
};

export function workspaceGitKey(target: HostTarget, path: string): string {
  return JSON.stringify([
    target.transport,
    target.transport === "ssh" ? target.alias : null,
    target.shellMode ?? null,
    path,
  ]);
}

export class WorkspaceGitStatusReader {
  private readonly inflight = new Map<string, Promise<AgentWorkspaceGitStatus>>();
  private readonly settled = new Map<string, CachedStatus>();

  constructor(
    private readonly inspect: (
      target: HostTarget,
      path: string,
    ) => Promise<AgentWorkspaceGitStatus> = inspectAgentWorkspaceGitStatus,
    private readonly now: () => number = Date.now,
    private readonly reuseMs = STATUS_REUSE_MS,
  ) {}

  read(target: HostTarget, path: string): Promise<AgentWorkspaceGitStatus> {
    const key = workspaceGitKey(target, path);
    const cached = this.settled.get(key);
    if (cached && this.now() - cached.settledAt < this.reuseMs) {
      return Promise.resolve(cached.status);
    }
    this.settled.delete(key);
    const running = this.inflight.get(key);
    if (running) return running;
    const inspection = this.inspect(target, path).then(
      (status) => {
        this.inflight.delete(key);
        this.settled.set(key, { status, settledAt: this.now() });
        return status;
      },
      (error: unknown) => {
        this.inflight.delete(key);
        throw error;
      },
    );
    this.inflight.set(key, inspection);
    return inspection;
  }
}
