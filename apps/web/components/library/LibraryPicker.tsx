"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LibraryBrowser } from "@/components/library/LibraryBrowser";
import type { LibraryItem } from "@/lib/library";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function LibraryPicker({ onClose, onAdd, attachedUrls }: {
  onClose: () => void;
  onAdd: (items: LibraryItem[]) => void;
  attachedUrls: ReadonlySet<string>;
}) {
  const [selected, setSelected] = useState(new Map<string, LibraryItem>());
  const additions = Array.from(selected.values()).filter((item) => !attachedUrls.has(item.url));
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={cn("fixed inset-0 z-50 bg-black/40", motionClasses.overlay)} />
        <Dialog.Popup className={cn("fixed left-1/2 top-1/2 z-50 flex h-[min(44rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border bg-background shadow-lg outline-none", motionClasses.dialog)}>
          <div className="flex items-center justify-between gap-4 px-4 pt-5 sm:px-6">
            <Dialog.Title className="text-xl font-semibold tracking-tight">Add from library</Dialog.Title>
            <Dialog.Close render={<Button variant="ghost" size="icon" aria-label="Close library" />}><X /></Dialog.Close>
          </div>
          <Dialog.Description className="px-4 pb-2 text-sm text-muted-foreground sm:px-6">Choose files from your saved chats.</Dialog.Description>
          <LibraryBrowser
            attachedUrls={attachedUrls}
            selected={selected}
            onToggle={(item) => setSelected((current) => {
              const next = new Map(current);
              if (next.has(item.id)) next.delete(item.id);
              else next.set(item.id, item);
              return next;
            })}
          />
          <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-4 sm:px-6">
            <span className="text-sm text-muted-foreground" role="status">{additions.length} selected</span>
            <Button disabled={!additions.length} onClick={() => { onAdd(additions); onClose(); }}>
              Add {additions.length || ""} {additions.length === 1 ? "file" : "files"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
