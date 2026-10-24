"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldQuestion } from "lucide-react";
import type { SignInDecision, SignInRequest } from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  decideSignInRequest,
  signInRequestsQuery,
  twoFactorQuery,
} from "@/lib/queries/auth";
import { authKeys } from "@/lib/queries/keys";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Asks whether a sign-in to this account is the user's, while they're signed
 * in here. They approve it by picking the number the signing-in device shows.
 */
export function SignInRequestPrompt() {
  const queryClient = useQueryClient();
  const { data: twoFactor } = useQuery(twoFactorQuery);
  const { data: requests } = useQuery({
    ...signInRequestsQuery,
    enabled: twoFactor?.enabled === true,
  });
  // Closing the dialog hides a request here without answering it.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [answering, setAnswering] = useState(false);
  const request = requests?.find((item) => !dismissed.has(item.id));
  if (!request) return null;

  function dismiss(id: string) {
    setDismissed((current) => new Set(current).add(id));
  }

  async function answer(target: SignInRequest, decision: SignInDecision) {
    setAnswering(true);
    try {
      const result = await decideSignInRequest(target.id, decision);
      dismiss(target.id);
      if (result === "approved") {
        toast.success({ title: "Sign-in approved", description: target.device });
      } else if (result === "mismatch") {
        toast.error({
          title: "Sign-in blocked",
          description:
            "That number didn't match. If you were signing in, try again; if not, change your password.",
        });
      } else if (result === "denied") {
        toast.success({
          title: "Sign-in denied",
          description: "If this wasn't you, change your password.",
        });
      } else {
        toast.error({ title: "This request expired" });
      }
    } catch {
      toast.error({
        title: "Couldn't answer the sign-in request",
        description: "Check your connection and try again.",
      });
    } finally {
      setAnswering(false);
      void queryClient.invalidateQueries({ queryKey: authKeys.signInRequests() });
    }
  }

  return (
    <Dialog.Root
      key={request.id}
      open
      onOpenChange={(next) => {
        if (!next) dismiss(request.id);
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
          <ShieldQuestion aria-hidden className="mb-3 size-6 text-ring" />
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Is this you signing in?
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {request.device}
            {request.ipAddress ? ` · ${request.ipAddress}` : ""}
          </Dialog.Description>
          <p className="mt-5 text-sm">Pick the number shown on the sign-in screen.</p>
          <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Number choices">
            {request.choices.map((number) => (
              <Button
                key={number}
                type="button"
                variant="outline"
                disabled={answering}
                className="h-14 font-mono text-2xl tabular-nums"
                onClick={() => void answer(request, { approve: true, number })}
              >
                {number}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="destructive"
            disabled={answering}
            className="mt-4 w-full"
            onClick={() => void answer(request, { approve: false })}
          >
            No, it&apos;s not me
          </Button>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
