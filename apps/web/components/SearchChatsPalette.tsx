"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Pencil, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupByDate, type DateBucket } from "@/lib/dateGroups";
import { useChats } from "@/lib/queries/chats";
import { useChatsSearch, type SearchHit } from "@/lib/queries/search";

type Chat = { id: string; title: string | null; updatedAt: number };

type Row =
  | { kind: "label"; label: DateBucket | "Results" }
  | { kind: "new" }
  | { kind: "chat"; chat: Chat }
  | { kind: "hit"; hit: SearchHit };

function renderSnippet(snippet: string) {
  let highlighted = false;
  return snippet.split(/(<\/?mark>)/g).map((part, i) => {
    if (part === "<mark>") {
      highlighted = true;
      return null;
    }
    if (part === "</mark>") {
      highlighted = false;
      return null;
    }
    if (!part) return null;
    return highlighted ? <mark key={i}>{part}</mark> : part;
  });
}

export function SearchChatsPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const { data: allChats = [] } = useChats();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const search = useChatsSearch(debouncedQuery);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("");
      setDebouncedQuery("");
      setActive(0);
    }
    onOpenChange(next);
  }

  const q = query.trim();
  const debouncedQ = debouncedQuery.trim();
  const showingResults = q.length >= 2;
  const hits = debouncedQ.length >= 2 ? search.data ?? null : null;
  const loading = showingResults && search.isFetching && !search.data;

  const chats: Chat[] = useMemo(
    () =>
      allChats.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
      })),
    [allChats],
  );

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [{ kind: "new" }];

    if (q.length < 2) {
      const groups = groupByDate(chats);
      for (const g of groups) {
        out.push({ kind: "label", label: g.label });
        for (const c of g.items) out.push({ kind: "chat", chat: c });
      }
      return out;
    }

    if (hits && hits.length) {
      out.push({ kind: "label", label: "Results" });
      for (const h of hits) out.push({ kind: "hit", hit: h });
    }
    return out;
  }, [chats, q, hits]);

  const selectableIndexes = useMemo(
    () =>
      rows
        .map((r, i) => (r.kind === "label" ? -1 : i))
        .filter((i) => i >= 0),
    [rows],
  );

  const effectiveActive = selectableIndexes.includes(active)
    ? active
    : (selectableIndexes[0] ?? 0);

  function activate(row: Row) {
    if (row.kind === "new") {
      handleOpenChange(false);
      router.push("/");
    } else if (row.kind === "chat") {
      handleOpenChange(false);
      router.push(`/chat/${row.chat.id}`);
    } else if (row.kind === "hit") {
      handleOpenChange(false);
      const suffix = row.hit.messageId ? `#m-${row.hit.messageId}` : "";
      router.push(`/chat/${row.hit.chatId}${suffix}`);
    }
  }

  function move(delta: number) {
    if (selectableIndexes.length === 0) return;
    const idx = selectableIndexes.indexOf(effectiveActive);
    const nextIdx =
      idx === -1
        ? 0
        : (idx + delta + selectableIndexes.length) % selectableIndexes.length;
    const nextRow = selectableIndexes[nextIdx];
    setActive(nextRow);
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${nextRow}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }

  const emptyResults =
    showingResults && !loading && hits !== null && hits.length === 0;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-[20%] z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-xl border bg-popover text-popover-foreground shadow-xl outline-none transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">
          <Dialog.Title className="sr-only">Search chats</Dialog.Title>
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  move(1);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  move(-1);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const row = rows[effectiveActive];
                  if (row) activate(row);
                }
              }}
              placeholder="Search chats…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              aria-label="Close"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <div
            ref={listRef}
            className="max-h-[50vh] overflow-y-auto p-1"
          >
            {rows.map((row, i) => {
              if (row.kind === "label") {
                return (
                  <div
                    key={`l-${row.label}-${i}`}
                    className="mt-2 mb-1 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase first:mt-1"
                  >
                    {row.label}
                  </div>
                );
              }
              const isActive = effectiveActive === i;
              if (row.kind === "new") {
                return (
                  <button
                    key="new"
                    type="button"
                    data-row-index={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => activate(row)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      isActive && "bg-accent text-accent-foreground",
                    )}
                  >
                    <Pencil className="size-4 shrink-0 text-muted-foreground" />
                    <span>New chat</span>
                  </button>
                );
              }
              if (row.kind === "chat") {
                return (
                  <button
                    key={row.chat.id}
                    type="button"
                    data-row-index={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => activate(row)}
                    className={cn(
                      "flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-sm",
                      isActive && "bg-accent text-accent-foreground",
                    )}
                  >
                    <span className="truncate">
                      {row.chat.title ?? "Untitled"}
                    </span>
                  </button>
                );
              }
              return (
                <button
                  key={`${row.hit.chatId}-${row.hit.messageId ?? "t"}`}
                  type="button"
                  data-row-index={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => activate(row)}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm",
                    isActive && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="truncate w-full">
                    {row.hit.title ?? "Untitled"}
                  </span>
                  {row.hit.snippet && (
                    <span className="line-clamp-2 text-xs text-muted-foreground [&_mark]:bg-transparent [&_mark]:font-medium [&_mark]:text-foreground">
                      {renderSnippet(row.hit.snippet)}
                    </span>
                  )}
                </button>
              );
            })}
            {showingResults && loading && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                Searching…
              </p>
            )}
            {emptyResults && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No chats match &ldquo;{q}&rdquo;
              </p>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
