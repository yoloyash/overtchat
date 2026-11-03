"use client";

import {
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { FileUp, ImageOff, ImageUp } from "lucide-react";
import { createFileDropHandlers, type FileDropHandlers } from "@/lib/chat/file-drop";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface FileDropZoneOptions {
  onFiles: (files: File[]) => void;
  /** Leave file drags alone, for example while a read-only session is shown. */
  disabled?: boolean;
  /** Show the refusing cursor; the drop still reaches `onFiles` so it can explain. */
  accepting?: boolean;
}

/**
 * Turns an element into a file drop zone. Spread `handlers` on the element and
 * render `FileDropOverlay` inside it while `active`.
 */
export function useFileDropZone(options: FileDropZoneOptions): {
  active: boolean;
  handlers: FileDropHandlers;
} {
  const [depth, setDepth] = useState(0);
  const { onFiles, disabled = false, accepting = true } = options;
  const active = depth > 0 && !disabled;

  const handlers = createFileDropHandlers({
    disabled: () => disabled,
    accepting: () => accepting,
    setDepth,
    onFiles,
  });

  // A drag that ends without a leave, such as Escape over the zone, resets the count.
  useEffect(() => {
    if (!active) return;
    const clear = () => setDepth(0);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, [active]);

  return { active, handlers };
}

export interface FileDropLabel {
  title: string;
  description: string;
}

/**
 * A container that accepts dropped files and shows an overlay while a file
 * drag is over it. `refused` replaces `overlay` while `accepting` is false.
 */
export function FileDropZone({
  onFiles,
  disabled,
  accepting = true,
  overlay,
  refused,
  kind = "files",
  className,
  children,
  ...rest
}: FileDropZoneOptions &
  Omit<ComponentPropsWithoutRef<"div">, "onDrop" | "children"> & {
    overlay: FileDropLabel;
    refused?: FileDropLabel;
    kind?: "files" | "images";
    children: ReactNode;
  }) {
  const zone = useFileDropZone({ onFiles, disabled, accepting });
  const label = !accepting && refused ? refused : overlay;
  return (
    <div {...rest} className={cn("relative", className)} {...zone.handlers}>
      {children}
      {zone.active && (
        <FileDropOverlay
          title={label.title}
          description={label.description}
          kind={kind}
          refusing={!accepting}
        />
      )}
    </div>
  );
}

export function FileDropOverlay({
  title,
  description,
  kind = "files",
  refusing = false,
}: FileDropLabel & {
  kind?: "files" | "images";
  refusing?: boolean;
}) {
  const Icon = refusing ? ImageOff : kind === "images" ? ImageUp : FileUp;
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/70 backdrop-blur-[2px] motion-overlay"
    >
      <div
        className={cn(
          "flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-background/90 px-8 py-6 text-center shadow-lg ring-1",
          refusing
            ? "border-muted-foreground/40 ring-muted-foreground/10"
            : "border-ring ring-ring/20",
        )}
      >
        <div
          className={cn(
            "flex size-14 items-center justify-center rounded-full shadow-sm",
            refusing
              ? "bg-muted text-muted-foreground"
              : "bg-primary text-primary-foreground",
            motionClasses.dropIcon,
          )}
        >
          <Icon className="size-6" />
        </div>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
      </div>
    </div>
  );
}
