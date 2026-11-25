"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export function ModelSearch({
  count,
  search,
  onSearch,
  expanded,
  onExpanded,
  heading,
  actions,
}: {
  count: number;
  search: string;
  onSearch: (value: string) => void;
  expanded: boolean;
  onExpanded: (value: boolean) => void;
  heading?: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const toggleRef = useRef<HTMLDivElement>(null);
  const alwaysVisible = count > 7;
  const visible = alwaysVisible || expanded;
  const focusSearch = useCallback(
    (node: HTMLInputElement | null) => {
      if (node && expanded) node.focus();
    },
    [expanded],
  );
  return (
    <div className="sticky top-0 z-10 bg-popover pb-1">
      <div className="flex min-h-9 items-center gap-1">
        <div className="min-w-0 flex-1">
          {heading ?? (
            <div className="px-2 text-xs font-medium text-muted-foreground">
              {t("app.modelPicker.modelsHeading")}
            </div>
          )}
        </div>
        {actions}
        {!alwaysVisible && count > 0 && (
          <Menu.Item
            ref={toggleRef}
            closeOnClick={false}
            aria-label={expanded ? t("app.modelPicker.closeModelSearch") : t("app.modelPicker.searchModels")}
            title={expanded ? t("app.modelPicker.closeSearch") : t("app.modelPicker.searchModels")}
            aria-expanded={expanded}
            onClick={() => {
              onSearch("");
              onExpanded(!expanded);
            }}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground"
          >
            {expanded ? (
              <X className="size-3.5" />
            ) : (
              <Search className="size-3.5" />
            )}
          </Menu.Item>
        )}
      </div>
      {visible && (
        <div className="relative mx-1 mb-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={focusSearch}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !alwaysVisible) {
                event.preventDefault();
                event.stopPropagation();
                onSearch("");
                onExpanded(false);
                toggleRef.current?.focus();
              } else if (
                !["Escape", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)
              ) {
                event.stopPropagation();
              }
            }}
            onClick={(event) => event.stopPropagation()}
            placeholder={t("app.modelPicker.searchModels")}
            aria-label={t("app.modelPicker.searchModels")}
            className="h-8 pl-7 text-xs md:text-xs"
          />
        </div>
      )}
    </div>
  );
}
