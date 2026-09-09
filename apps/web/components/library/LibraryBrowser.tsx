"use client";

import { useEffect, useState } from "react";
import { Check, LayoutGrid, Library, List, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryIcon } from "@/components/chat/attachment-icons";
import { formatSize, humanMediaLabel } from "@/lib/chat/attachments";
import { useLibrary } from "@/lib/queries/library";
import type { LibraryItem } from "@/lib/library";
import { cn } from "@/lib/utils";

interface LibraryBrowserProps {
  selected?: ReadonlyMap<string, LibraryItem>;
  attachedUrls?: ReadonlySet<string>;
  onToggle?: (item: LibraryItem) => void;
}

export function LibraryBrowser({ selected, attachedUrls, onToggle }: LibraryBrowserProps) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const library = useLibrary(query);
  const items = library.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-4 sm:px-6">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search library"
            placeholder="Search library"
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 pl-9"
          />
        </div>
        <div role="group" aria-label="Library view" className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn(view === "list" && "bg-accent")}>
            <List />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn(view === "grid" && "bg-accent")}>
            <LayoutGrid />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" aria-busy={library.isFetching}>
        {library.isPending ? (
          <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading library…</p>
        ) : library.isError && !items.length ? (
          <div role="alert" className="space-y-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">Could not load your library.</p>
            <Button variant="outline" onClick={() => void library.refetch()}>Try again</Button>
          </div>
        ) : !items.length ? (
          <div role="status" className="flex flex-col items-center gap-3 py-12 text-center">
            <Library className="size-8 text-muted-foreground" />
            <p className="font-medium">{query ? "No matching files" : "Your library is empty"}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {query ? "Try another filename." : "Files you attach to saved chats appear here, ready to use again."}
            </p>
          </div>
        ) : (
          <ul aria-label="Library files" className={cn(view === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "space-y-1")}>
            {items.map((item) => {
              const attached = attachedUrls?.has(item.url) ?? false;
              const checked = attached || (selected?.has(item.id) ?? false);
              const className = cn(
                "relative flex w-full min-w-0 gap-3 rounded-xl p-3 text-left motion-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring",
                view === "grid" ? "h-full flex-col border" : "items-center",
                onToggle && checked && "bg-accent",
                attached && "opacity-50",
              );
              const content = (
                <>
                  <LibraryPreview item={item} grid={view === "grid"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" title={item.filename}>{item.filename}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {humanMediaLabel(item.mediaType)} · {formatSize(item.size)}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {attached ? "Already attached" : new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </span>
                  {onToggle && (
                    <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center rounded border", view === "grid" && "absolute right-3 top-3", checked ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>
                      {checked && <Check className="size-3.5" />}
                    </span>
                  )}
                </>
              );
              return (
                <li key={item.id} className="min-w-0">
                  {onToggle ? (
                    <button type="button" className={className} aria-label={item.filename} aria-pressed={checked} disabled={attached} onClick={() => onToggle(item)}>{content}</button>
                  ) : (
                    <a className={className} href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.filename}`}>{content}</a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {items.length > 0 && library.isError && (
          <div role="alert" className="mt-4 text-center text-sm">
            Could not refresh your library. <Button variant="ghost" onClick={() => void library.refetch()}>Try again</Button>
          </div>
        )}
        {library.hasNextPage && (
          <div className="mt-5 text-center">
            <Button variant="outline" disabled={library.isFetching} onClick={() => void library.fetchNextPage()}>
              {library.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryPreview({ item, grid }: { item: LibraryItem; grid: boolean }) {
  const className = cn("flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted", grid ? "aspect-[4/3] w-full" : "size-12");
  return (
    <span className={className}>
      {item.category === "image" ? (
        // Authenticated upload URLs are already local and should bypass optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <CategoryIcon category={item.category} className={cn("text-muted-foreground", grid ? "size-10" : "size-6")} />
      )}
    </span>
  );
}
