"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { twoFactorQuery } from "@/lib/queries/auth";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Set once this browser has shown the prompt, so it appears only once. */
export const TWO_FACTOR_PROMPT_STORAGE_KEY = "overtchat_two_factor_prompted";

function alreadyPrompted() {
  try {
    return localStorage.getItem(TWO_FACTOR_PROMPT_STORAGE_KEY) !== null;
  } catch {
    return true;
  }
}

/**
 * Suggests two-factor once per browser, after sign-in, to users who haven't set
 * it up.
 * Administrators the server requires to use it get the setup screen instead.
 */
export function TwoFactorPrompt() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(() => !alreadyPrompted());
  const { data: status } = useQuery({ ...twoFactorQuery, enabled: open });

  if (!open || !status || status.enabled || status.required) return null;

  function close() {
    try {
      localStorage.setItem(TWO_FACTOR_PROMPT_STORAGE_KEY, new Date().toISOString());
    } catch {
      // Storage is unavailable; the prompt may show again next time.
    }
    setOpen(false);
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)} />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <ShieldCheck aria-hidden className="mb-3 size-6 text-ring" />
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Protect your account
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Turn on two-factor authentication so a stolen password isn&apos;t
            enough to get in. Sign-in will also ask for a code from an
            authenticator app on your phone. It takes about a minute.
          </Dialog.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Not now
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                close();
                void navigate({ to: "/settings/account", search: { setup: "two-factor" } });
              }}
            >
              Set up two-factor
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            You can always find this in Settings → Security.
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
