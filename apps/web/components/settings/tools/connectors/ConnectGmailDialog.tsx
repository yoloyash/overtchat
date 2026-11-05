"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { GmailLogo } from "@/components/GmailLogo";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import { motionClasses } from "@/lib/motion";
import {
  startIntegrationAuthorization,
  useConnectIntegration,
} from "@/lib/queries/integrations";
import { integrationKeys } from "@/lib/queries/keys";
import { cn } from "@/lib/utils";
import { SettingsActions, SettingsNotice } from "../../SettingsRows";

/** Whether pasted text is already the whole address Google sent the browser to. */
function isRedirectAddress(text: string): boolean {
  try {
    const { searchParams } = new URL(text);
    return searchParams.has("code") && searchParams.has("state");
  } catch {
    return false;
  }
}

/**
 * Google sends the browser to an address on the user's own computer, where
 * nothing answers. The user brings that address back here to finish.
 */
export function ConnectGmailDialog({ onClose }: { onClose: () => void }) {
  const connect = useConnectIntegration("gmail");
  const [attempt, setAttempt] = useState(0);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [error, setError] = useState("");

  // Each start replaces the pending sign-in on the server, so it must run
  // once per attempt and never again when the user returns from Google's tab.
  const authorization = useQuery({
    queryKey: [...integrationKeys.all(), "authorization", "gmail", attempt],
    queryFn: () => startIntegrationAuthorization("gmail"),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  async function submit(address: string) {
    if (connect.isPending) return;
    setError("");
    try {
      const integration = await connect.mutateAsync(address);
      toast.success({
        title: "Gmail connected",
        description: integration.connection?.accountEmail,
      });
      onClose();
    } catch (error) {
      setError(getErrorMessage(error, "Could not connect Gmail. Try again."));
    }
  }

  function startAgain() {
    setError("");
    setRedirectUrl("");
    setAttempt((value) => value + 1);
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !connect.isPending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <GmailLogo className="size-5" />
            Connect Gmail
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Sign in with Google, then bring the result back here.
          </Dialog.Description>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(redirectUrl);
            }}
            className="mt-5 space-y-5"
          >
            <Step number={1} title="Sign in with Google">
              <p>
                Allow access and tick every checkbox. If Google says it
                hasn&apos;t verified this app, continue anyway. If it says
                access is blocked, an administrator needs to add your Google
                address as a test user first.
              </p>
              {authorization.isError ? (
                <SettingsNotice tone="error" className="mt-2">
                  {getErrorMessage(
                    authorization.error,
                    "Could not start the sign-in. Try again.",
                  )}
                </SettingsNotice>
              ) : (
                <a
                  href={authorization.data}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!authorization.data}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "mt-2",
                    !authorization.data && "pointer-events-none opacity-50",
                  )}
                >
                  <ExternalLink /> Open Google sign-in
                </a>
              )}
            </Step>

            <Step number={2} title="Copy the address of the page you land on">
              <p>
                Your browser will show a page that can&apos;t be reached. That
                is expected. Copy its whole address, which starts with{" "}
                <span className="font-mono text-foreground">
                  http://localhost
                </span>
                .
              </p>
            </Step>

            <Step number={3} title="Paste it here">
              <Label htmlFor="gmail-redirect-url" className="sr-only">
                Address from your browser
              </Label>
              <Input
                id="gmail-redirect-url"
                className="mt-1 font-mono"
                placeholder="http://localhost:1/?state=…&code=…"
                autoComplete="off"
                spellCheck={false}
                required
                value={redirectUrl}
                onChange={(event) => setRedirectUrl(event.target.value)}
                // A pasted address is the whole answer, so it needs no click.
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData("text").trim();
                  if (!isRedirectAddress(pasted)) return;
                  event.preventDefault();
                  setRedirectUrl(pasted);
                  void submit(pasted);
                }}
                disabled={connect.isPending}
              />
            </Step>

            {error && <SettingsNotice tone="error">{error}</SettingsNotice>}

            <SettingsActions bordered={false} className="justify-between pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={connect.isPending || authorization.isFetching}
                onClick={startAgain}
              >
                Start again
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={connect.isPending}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={connect.isPending || !redirectUrl.trim()}
                >
                  {connect.isPending ? "Connecting…" : "Connect"}
                </Button>
              </div>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium text-muted-foreground"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-6">{title}</p>
        <div className="text-xs leading-5 text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
