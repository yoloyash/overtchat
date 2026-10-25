"use client";

// Workspaces whose Git status is on screen. The connection events stream
// subscribes to exactly this set; a workspace is "live" once the server has
// confirmed pushed updates for it, which replaces polling for that workspace.
const watched = new Map<string, number>();
const live = new Set<string>();
const listeners = new Set<() => void>();
let watchedKey = "";

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function updateWatchedKey(): void {
  const next = [...watched.keys()].sort().join(",");
  if (next === watchedKey) return;
  watchedKey = next;
  notify();
}

export function subscribeAgentWorkspaceGitWatches(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sorted, comma-separated ids; stable while the watched set is unchanged. */
export function agentWorkspaceGitWatchKey(): string {
  return watchedKey;
}

export function watchAgentWorkspaceGit(id: string): () => void {
  watched.set(id, (watched.get(id) ?? 0) + 1);
  updateWatchedKey();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (watched.get(id) ?? 1) - 1;
    if (count > 0) {
      watched.set(id, count);
      return;
    }
    watched.delete(id);
    live.delete(id);
    updateWatchedKey();
  };
}

export function isAgentWorkspaceGitLive(id: string): boolean {
  return live.has(id);
}

export function setAgentWorkspaceGitLive(id: string, value: boolean): void {
  if (value === live.has(id)) return;
  if (value && !watched.has(id)) return;
  if (value) live.add(id);
  else live.delete(id);
  notify();
}

/** The stream closed or is reconnecting; every watch falls back to polling. */
export function clearAgentWorkspaceGitLive(): void {
  if (live.size === 0) return;
  live.clear();
  notify();
}
