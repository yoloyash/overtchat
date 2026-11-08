"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { motionClasses } from "@/lib/motion";
import { formatSize, humanMediaLabel } from "@/lib/chat/attachments";
import type { ProjectFileItem } from "@/lib/project-files";
import { CategoryIcon } from "./attachment-icons";
import { MenuRow } from "./SlashCommandMenu";

interface Props {
  id: string;
  /** Owned by the composer, which points `aria-activedescendant` at a row. */
  optionIdPrefix: string;
  /** Already filtered, in project order. */
  files: readonly ProjectFileItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (file: ProjectFileItem) => void;
}

/** The project's files, for a `#` mention in the composer. */
export function FileMentionMenu({
  id,
  optionIdPrefix,
  files,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      className={cn(
        "absolute bottom-full left-0 z-50 mb-2 w-full max-w-lg overflow-hidden rounded-xl border bg-popover text-sm text-popover-foreground shadow-md",
        motionClasses.palette,
      )}
    >
      <div
        ref={listRef}
        id={id}
        role="listbox"
        aria-label="Project files"
        className="max-h-72 overflow-y-auto p-1.5"
      >
        <div
          aria-hidden
          className="px-2.5 pt-1.5 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          Attach a project file
        </div>
        {files.map((file, index) => (
          <MenuRow
            key={file.uploadId}
            id={`${optionIdPrefix}-${index}`}
            index={index}
            active={index === activeIndex}
            disabled={false}
            icon={<CategoryIcon category={file.category} className="size-4" />}
            title={file.filename}
            description={`${humanMediaLabel(file.mediaType)} · ${formatSize(file.size)}${
              file.pageCount ? ` · ${file.pageCount} ${file.pageCount === 1 ? "page" : "pages"}` : ""
            }`}
            onActivate={() => onSelect(file)}
            onHover={() => onActiveIndexChange(index)}
          />
        ))}
      </div>
    </div>
  );
}
