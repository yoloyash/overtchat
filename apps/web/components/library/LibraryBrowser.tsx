"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "@/components/I18nProvider";
import { Check, LayoutGrid, Library, List, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryIcon } from "@/components/chat/attachment-icons";
import { formatSize, humanMediaLabel } from "@/lib/chat/attachments";
import { useLibrary } from "@/lib/queries/library";
import type { LibraryItem } from "@/lib/library";
import { cn } from "@/lib/utils";
import { serverUrl } from "@/lib/api-url";

function formatLibraryDate(createdAt: number | string, locale: string): string {
  return new Date(createdAt).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function libraryItemClassName(
  view: "list" | "grid",
  highlighted: boolean,
  attached: boolean,
): string {
  return cn(
    "relative flex w-full min-w-0 gap-3 rounded-xl p-3 text-left motion-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring",
    view === "grid" ? "h-full flex-col border" : "items-center",
    highlighted && "bg-accent",
    attached && "opacity-50",
  );
}

interface LibraryBrowserProps {
  selected?: ReadonlyMap<string, LibraryItem>;
  attachedUrls?: ReadonlySet<string>;
  onToggle?: (item: LibraryItem) => void;
}

export function LibraryBrowser({ selected, attachedUrls, onToggle }: LibraryBrowserProps) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
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
            aria-label={t("library.browser.search")}
            placeholder={t("library.browser.search")}
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 pl-9"
          />
        </div>
        <div role="group" aria-label={t("library.browser.viewLabel")} className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={t("library.browser.listView")} aria-pressed={view === "list"} onClick={() => setView("list")} className={cn(view === "list" && "bg-accent")}>
            <List />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("library.browser.gridView")} aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn(view === "grid" && "bg-accent")}>
            <LayoutGrid />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" aria-busy={library.isFetching}>
        {library.isPending ? (
          <p role="status" className="py-12 text-center text-sm text-muted-foreground">{t("library.browser.loading")}</p>
        ) : library.isError && !items.length ? (
          <div role="alert" className="space-y-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("library.browser.loadError")}</p>
            <Button variant="outline" onClick={() => void library.refetch()}>{t("common.actions.tryAgain")}</Button>
          </div>
        ) : !items.length ? (
          <div role="status" className="flex flex-col items-center gap-3 py-12 text-center">
            <Library className="size-8 text-muted-foreground" />
            <p className="font-medium">{query ? t("library.browser.emptySearchTitle") : t("library.browser.emptyTitle")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {query ? t("library.browser.emptySearchDescription") : t("library.browser.emptyDescription")}
            </p>
          </div>
        ) : (
          <ul aria-label={t("library.browser.filesLabel")} className={cn(view === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "space-y-1")}>
            {items.map((item) => {
              const attached = attachedUrls?.has(item.url) ?? false;
              const checked = attached || (selected?.has(item.id) ?? false);
              const className = libraryItemClassName(
                view,
                Boolean(onToggle && checked),
                attached,
              );
              const content = (
                <>
                  <LibraryPreview item={item} grid={view === "grid"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" title={item.filename}>{item.filename}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {humanMediaLabel(item.mediaType, t)} · {formatSize(item.size, t)}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {attached ? t("library.browser.alreadyAttached") : formatLibraryDate(item.createdAt, locale)}
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
                    <a className={className} href={serverUrl(item.url)} target="_blank" rel="noopener noreferrer" aria-label={t("library.browser.openFile", { filename: item.filename })}>{content}</a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {items.length > 0 && library.isError && (
          <div role="alert" className="mt-4 text-center text-sm">
            {t("library.browser.refreshError")}{" "}<Button variant="ghost" onClick={() => void library.refetch()}>{t("common.actions.tryAgain")}</Button>
          </div>
        )}
        {library.hasNextPage && (
          <div className="mt-5 text-center">
            <Button variant="outline" disabled={library.isFetching} onClick={() => void library.fetchNextPage()}>
              {library.isFetchingNextPage ? t("common.states.loading") : t("library.browser.loadMore")}
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
        <img src={serverUrl(item.url)} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <CategoryIcon category={item.category} className={cn("text-muted-foreground", grid ? "size-10" : "size-6")} />
      )}
    </span>
  );
}
