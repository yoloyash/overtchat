"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { History, Search, X } from "lucide-react";
import {
  agentProviderMetadata,
  isAgentProviderId,
  type AgentProviderId,
} from "@overtchat/agent-bridge";
import { formatUpdatedAt } from "@overtchat/shared";
import { SidebarToggle } from "@/components/SidebarToggle";
import {
  AgentProviderLogo,
  AgentSessionStatusIcon,
  agentSessionStateLabel,
} from "@/components/agents/AgentSessionStatus";
import { agentSessionRowTitle } from "@/components/agents/AgentSessionRow";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  agentSessionNeedsOwner,
  type AgentAttentionItem,
} from "@/lib/agents/attention";
import {
  agentSessionCreatedAt,
  agentSessionHosts,
  agentSessionProviders,
  agentSessionWorkspaces,
  searchAgentSessions,
  type AgentSessionSort,
} from "@/lib/agents/search";
import { agentHostLabel, groupAgentWorkspaces } from "@/lib/agents/workspaces";
import { groupByDate } from "@/lib/dateGroups";
import { useAgentConnections } from "@/lib/queries/agentConnections";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 200;

export type AgentHistorySearch = {
  q?: string;
  host?: string;
  workspace?: string;
  provider?: string;
  sort?: string;
};

/** Applies changed filters, leaving cleared ones out of the address. */
function withSearch(
  previous: AgentHistorySearch,
  patch: AgentHistorySearch,
): AgentHistorySearch {
  return Object.fromEntries(
    Object.entries({ ...previous, ...patch }).filter(([, value]) => value),
  ) as AgentHistorySearch;
}

const SORT_LABELS: Record<AgentSessionSort, string> = {
  activity: "Last active",
  created: "Created",
};

/**
 * Every agent session, searchable, with filters that narrow in the same order
 * as the new-session pickers: the machine, a folder on it, then an agent with
 * sessions there. A filter outside that scope is ignored.
 */
export function AgentHistoryView({ search }: { search: AgentHistorySearch }) {
  const navigate = useNavigate();
  const { data: connections = [], isPending } = useAgentConnections();
  const groups = useMemo(() => groupAgentWorkspaces(connections), [connections]);
  const hosts = useMemo(() => agentSessionHosts(groups), [groups]);
  const allWorkspaces = useMemo(() => agentSessionWorkspaces(groups, null), [groups]);
  const allProviders = useMemo(() => agentSessionProviders(groups, null, null), [groups]);
  // What was typed, over which address; the History link or going back changes
  // the address underneath, and the box follows it.
  const [typed, setTyped] = useState({ value: search.q ?? "", over: search.q });
  const query = typed.over === search.q ? typed.value : (search.q ?? "");
  const setQuery = (value: string) => setTyped({ value, over: search.q });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const host = search.host && hosts.includes(search.host) ? search.host : null;
  const workspaces = useMemo(() => agentSessionWorkspaces(groups, host), [groups, host]);
  const workspace =
    search.workspace && workspaces.includes(search.workspace) ? search.workspace : null;
  const providers = useMemo(
    () => agentSessionProviders(groups, host, workspace),
    [groups, host, workspace],
  );
  const provider: AgentProviderId | null =
    search.provider && isAgentProviderId(search.provider) && providers.includes(search.provider)
      ? search.provider
      : null;
  const sort: AgentSessionSort = search.sort === "created" ? "created" : "activity";
  const now = useNow(30_000);

  function updateSearch(patch: AgentHistorySearch) {
    setLimit(PAGE_SIZE);
    void navigate({
      to: "/agents/history",
      search: (previous: AgentHistorySearch) => withSearch(previous, patch),
      replace: true,
    });
  }

  /** The agent filter, if it still has sessions in the narrowed scope. */
  function keptProvider(nextHost: string | null, nextWorkspace: string | null) {
    return provider && agentSessionProviders(groups, nextHost, nextWorkspace).includes(provider)
      ? provider
      : undefined;
  }

  // Changing the machine drops a folder or agent that has no sessions on it.
  function selectHost(next: string | null) {
    const nextWorkspace =
      workspace && agentSessionWorkspaces(groups, next).includes(workspace) ? workspace : null;
    updateSearch({
      host: next ?? undefined,
      workspace: nextWorkspace ?? undefined,
      provider: keptProvider(next, nextWorkspace),
    });
  }

  function selectWorkspace(next: string | null) {
    updateSearch({ workspace: next ?? undefined, provider: keptProvider(host, next) });
  }

  // The list filters as you type; the address follows once typing pauses.
  useEffect(() => {
    if (query === (search.q ?? "")) return;
    const timer = setTimeout(() => {
      void navigate({
        to: "/agents/history",
        search: (previous: AgentHistorySearch) =>
          withSearch(previous, { q: query || undefined }),
        replace: true,
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [navigate, query, search.q]);

  const results = useMemo(
    () => searchAgentSessions(groups, { query, host, workspace, provider, sort }),
    [groups, query, host, workspace, provider, sort],
  );
  const shown = results.slice(0, limit);
  const buckets = groupByDate(
    shown.map((entry) => ({
      entry,
      updatedAt: sort === "created" ? agentSessionCreatedAt(entry) : entry.since,
    })),
    now,
  );
  const totalSessions = groups.reduce((total, group) => total + group.sessions.length, 0);
  const filtered = Boolean(query.trim() || host || workspace || provider);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header data-titlebar className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarToggle />
        <h1 className="text-sm font-medium">History</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-2 pb-10 sm:px-6">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE_SIZE);
              }}
              placeholder="Search sessions"
              aria-label="Search sessions"
              autoFocus={typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches}
              className="h-10 pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground motion-colors hover:bg-accent hover:text-foreground"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hosts.length > 1 && (
              <Select value={host} onValueChange={selectHost}>
                <SelectTrigger size="sm" className="max-w-48" aria-label="Machine">
                  <SelectValue>{(value: string | null) => value ?? "All machines"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All machines</SelectItem>
                  {hosts.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {allWorkspaces.length > 1 && (
              <Select value={workspace} onValueChange={selectWorkspace}>
                <SelectTrigger size="sm" className="max-w-56" aria-label="Workspace">
                  <SelectValue>
                    {(value: string | null) => value ?? "All workspaces"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All workspaces</SelectItem>
                  {workspaces.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {allProviders.length > 1 && (
              <Select
                value={provider}
                onValueChange={(value) => updateSearch({ provider: value ?? undefined })}
              >
                <SelectTrigger size="sm" aria-label="Agent">
                  <SelectValue>
                    {(value: string | null) =>
                      value && isAgentProviderId(value)
                        ? agentProviderMetadata(value).label
                        : "All agents"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All agents</SelectItem>
                  {providers.map((item) => (
                    <SelectItem key={item} value={item}>
                      {agentProviderMetadata(item).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={sort}
              onValueChange={(value) =>
                updateSearch({ sort: value === "created" ? "created" : undefined })
              }
            >
              <SelectTrigger size="sm" aria-label="Sort by">
                <SelectValue>
                  {(value: string) =>
                    `Sort: ${SORT_LABELS[value === "created" ? "created" : "activity"]}`
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="activity">{SORT_LABELS.activity}</SelectItem>
                <SelectItem value="created">{SORT_LABELS.created}</SelectItem>
              </SelectContent>
            </Select>
            <span role="status" className="ml-auto text-xs tabular-nums text-muted-foreground">
              {isPending
                ? "Loading…"
                : `${results.length} ${results.length === 1 ? "session" : "sessions"}`}
            </span>
          </div>
          {!isPending && totalSessions === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <History aria-hidden="true" className="size-8 text-muted-foreground" />
              <h2 className="mt-3 text-base font-semibold">No agent sessions yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sessions you start or run on your machines are listed here.
              </p>
              <Link to="/agents" className={cn(buttonVariants({ size: "sm" }), "mt-4")}>
                New agent
              </Link>
            </div>
          ) : !isPending && results.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <p className="text-sm text-muted-foreground">No sessions match.</p>
              {filtered && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setQuery("");
                    updateSearch({
                      q: undefined,
                      host: undefined,
                      workspace: undefined,
                      provider: undefined,
                    });
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <>
              {buckets.map((bucket) => (
                <section key={bucket.label} aria-label={bucket.label}>
                  <h2 className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                    {bucket.label}
                  </h2>
                  <ul className="flex flex-col">
                    {bucket.items.map(({ entry, updatedAt }) => (
                      <HistoryRow
                        key={entry.item.session.id}
                        entry={entry}
                        time={formatUpdatedAt(updatedAt, now)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {results.length > shown.length && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center"
                  onClick={() => setLimit((current) => current + PAGE_SIZE)}
                >
                  Show {Math.min(PAGE_SIZE, results.length - shown.length)} more
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ entry, time }: { entry: AgentAttentionItem; time: string }) {
  const { item, group, state } = entry;
  const { session, provider } = item;
  const title = agentSessionRowTitle(entry);
  const needsOwner = agentSessionNeedsOwner(state);
  // What it is asking, why it failed, or how it last replied.
  const snippet = session.attention
    ? [session.attention.title, session.attention.detail].filter(Boolean).join(" · ")
    : state === "failed"
      ? session.lastTurn?.error || "The last turn failed."
      : session.lastTurn?.preview ||
        (session.firstMessage && session.firstMessage !== title ? session.firstMessage : null);
  return (
    <li>
      <Link
        to="/agents/$id"
        params={{ id: session.id }}
        className="flex min-w-0 items-start gap-3 rounded-lg px-3 py-2.5 outline-none motion-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          <AgentSessionStatusIcon state={state} />
          {state !== "idle" && (
            <span className="sr-only">{agentSessionStateLabel(state)}:</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-3">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                state !== "idle" && state !== "working" && "font-medium",
              )}
            >
              {title}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{time}</span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <AgentProviderLogo provider={provider} />
            <span className="truncate">
              {agentProviderMetadata(provider).label} · {group.name} · {agentHostLabel(group.host)}
            </span>
          </span>
          {snippet && (
            <span
              className={cn(
                "mt-1 line-clamp-2 text-xs text-muted-foreground",
                state === "failed" && "text-destructive/90",
                needsOwner && state !== "failed" && "text-amber-600 dark:text-amber-400/90",
              )}
            >
              {snippet}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
