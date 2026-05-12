"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Pencil, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupByDate, type DateBucket } from "@/lib/dateGroups";

type Chat = { id: string; title: string | null; updatedAt: number };

type Row =
  | { kind: "label"; label: DateBucket | "New" }
  | { kind: "new" }
  | { kind: "chat"; chat: Chat };

export function SearchChatsPalette({
  open,
  onOpenChange,
  chats,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chats: Chat[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("");
      setActive(0);
    }
    onOpenChange(next);
  }

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? chats.filter((c) => (c.title ?? "").toLowerCase().includes(q))
      : chats;

    const out: Row[] = [{ kind: "new" }];
    if (filtered.length === 0) return out;
    const groups = groupByDate(filtered);
    for (const g of groups) {
      out.push({ kind: "label", label: g.label });
      for (const c of g.items) out.push({ kind: "chat", chat: c });
    }
    return out;
  }, [chats, query]);

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
            })}
            {rows.length === 1 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No chats match &ldquo;{query}&rdquo;
              </p>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
