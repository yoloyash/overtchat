"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Download, LoaderCircle, RotateCw, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { UpdateActionTooltip } from "@/components/UpdateActionTooltip";
import { toast } from "@/components/ui/toast";
import { desktopBridge } from "@/lib/desktop";
import { getErrorMessage } from "@/lib/errors";
import { desktopUpdateLabel, useDesktopUpdate } from "@/lib/useDesktopUpdate";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function DesktopUpdateAction({ alwaysVisible = false, onServerUpdate }: {
  alwaysVisible?: boolean;
  onServerUpdate?: () => void;
}) {
  const state = useDesktopUpdate();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (!state || (!alwaysVisible && ["idle", "checking", "unsupported"].includes(state.status))) return null;
  const ready = state.status === "ready";
  const downloading = state.status === "downloading";
  const busy = pending || ["checking", "downloading", "installing"].includes(state.status);
  const label = desktopUpdateLabel(state);
  const text = downloading || state.status === "installing" ? label
    : state.status === "error" ? "Retry"
      : alwaysVisible ? state.status === "available" ? "Download update" : label : null;
  const tooltip = state.message || label;
  const Icon = busy ? LoaderCircle : ready || state.status === "error" ? RotateCw
    : state.status === "blocked" ? TriangleAlert : Download;

  async function act(confirmed = false) {
    const bridge = desktopBridge();
    if (!bridge || !state || busy) return;
    if (ready && !confirmed) { setConfirmOpen(true); return; }
    if (state.status === "blocked") {
      if (onServerUpdate) onServerUpdate();
      else toast.error({ title: "Desktop update unavailable", description: state.message ?? "Check for a compatible release later." });
      return;
    }
    setPending(true);
    try {
      if (ready) { await bridge.installUpdate(); setConfirmOpen(false); }
      else if (["available", "error"].includes(state.status)) await bridge.downloadUpdate();
      else await bridge.checkForUpdates();
    } catch (error) {
      toast.error({ title: "Could not update the desktop app", description: getErrorMessage(error, "Try again.") });
    } finally { setPending(false); }
  }

  if (state.status === "unsupported") {
    return <a href="https://overtchat.com/releases/" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>Desktop downloads</a>;
  }
  return (
    <>
      <UpdateActionTooltip content={tooltip}>
        <Button
          type="button" variant="ghost" size="sm" disabled={busy} aria-label={label}
          onClick={() => void act()}
          className={cn("h-8 shrink-0 gap-1 px-1.5 text-[11px] hover:bg-sidebar-accent", busy ? "text-muted-foreground" : state.status === "error" ? "text-destructive" : "text-ring")}
        >
          <Icon className={cn("size-3.5 shrink-0", busy && "animate-spin")} aria-hidden="true" />
          {text && <span className="whitespace-nowrap" aria-live="polite">{text}</span>}
        </Button>
      </UpdateActionTooltip>
      <Dialog.Root open={confirmOpen && ready} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)} />
          <Dialog.Popup className={cn("fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 text-card-foreground shadow-lg outline-none", motionClasses.dialog)}>
            <Dialog.Title className="text-base font-semibold">Update ready</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">Restart to install v{state.availableVersion}?</Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close render={<Button variant="outline" size="sm" />}>Later</Dialog.Close>
              <Button size="sm" disabled={pending} onClick={() => void act(true)}>Update and restart</Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
