"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { GoogleLogo } from "@/components/GoogleLogo";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import {
  providerIntegrations,
  type IntegrationId,
} from "@/lib/integrations/schema";
import { motionClasses } from "@/lib/motion";
import {
  startIntegrationAuthorization,
  useConnectIntegrationAccount,
} from "@/lib/queries/integrations";
import { integrationKeys } from "@/lib/queries/keys";
import { cn } from "@/lib/utils";
import { SettingsActions, SettingsNotice } from "../../SettingsRows";
import { INTEGRATION_DISPLAY, integrationNames } from "./integration-display";

const SERVICES = providerIntegrations("google");

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
 * One Google sign-in covers whichever of Google's connectors the user picks
 * here. Google sends the browser to an address on the user's own computer,
 * where nothing answers. The user brings that address back here to finish.
 */
export function ConnectGoogleDialog({
  initial,
  onClose,
}: {
  /** What the sign-in covers unless the user changes it. */
  initial: readonly IntegrationId[];
  onClose: () => void;
}) {
  const connect = useConnectIntegrationAccount("google");
  // Kept in the provider's own order, so the same choice is the same sign-in.
  const [selected, setSelected] = useState(() =>
    SERVICES.filter((id) => initial.includes(id)),
  );
  const [attempt, setAttempt] = useState(0);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [error, setError] = useState("");

  // Each start replaces the pending sign-in on the server, so it must run
  // once per choice and attempt, and never again when the user returns from
  // Google's tab.
  const authorization = useQuery({
    queryKey: [
      ...integrationKeys.all(),
      "authorization",
      "google",
      selected,
      attempt,
    ],
    queryFn: () => startIntegrationAuthorization("google", selected),
    enabled: selected.length > 0,
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
      const integrations = await connect.mutateAsync(address);
      const connected = integrations.filter(({ connection }) => connection);
      const leftOut = selected.filter(
        (id) => !connected.some((integration) => integration.id === id),
      );
      if (leftOut.length > 0) {
        toast.warning({
          title: `${integrationNames(connected.map(({ id }) => id))} connected`,
          description: `${integrationNames(leftOut)} was not allowed on Google's page. Change access to add it.`,
        });
      } else {
        toast.success({
          title: `${integrationNames(selected)} connected`,
          description: connected[0]?.connection?.accountEmail,
        });
      }
      onClose();
    } catch (error) {
      setError(getErrorMessage(error, "Could not connect Google. Try again."));
    }
  }

  function toggle(id: IntegrationId, on: boolean) {
    setError("");
    setRedirectUrl("");
    setSelected((current) =>
      SERVICES.filter((service) =>
        service === id ? on : current.includes(service),
      ),
    );
  }

  // The choice is a step of its own only when there is one to make.
  const choosing = SERVICES.length > 1;
  const first = choosing ? 2 : 1;

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
            <GoogleLogo className="size-5" />
            Connect Google
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
            {choosing && (
              <Step number={1} title="Choose what to connect">
                <ul className="mt-1 space-y-2">
                  {SERVICES.map((id) => {
                    const { name, Logo, description } = INTEGRATION_DISPLAY[id];
                    return (
                      <li key={id} className="flex items-start gap-2.5">
                        <Logo className="mt-1 size-4" />
                        <div className="min-w-0 flex-1">
                          <Label
                            htmlFor={`connect-${id}`}
                            className="text-sm font-medium text-foreground"
                          >
                            {name}
                          </Label>
                          <p>{description}</p>
                        </div>
                        <Switch
                          id={`connect-${id}`}
                          className="mt-1"
                          checked={selected.includes(id)}
                          disabled={connect.isPending}
                          onCheckedChange={(on) => toggle(id, on)}
                        />
                      </li>
                    );
                  })}
                </ul>
              </Step>
            )}

            <Step number={first} title="Sign in with Google">
              <p>
                Allow access, ticking any checkbox Google shows. If Google says it
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
              ) : selected.length === 0 ? (
                <SettingsNotice className="mt-2">
                  Choose at least one thing to connect.
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

            <Step
              number={first + 1}
              title="Copy the address of the page you land on"
            >
              <p>
                Your browser will show a page that can&apos;t be reached. That
                is expected. Copy its whole address, which starts with{" "}
                <span className="font-mono text-foreground">
                  http://localhost
                </span>
                .
              </p>
            </Step>

            <Step number={first + 2} title="Paste it here">
              <Label htmlFor="google-redirect-url" className="sr-only">
                Address from your browser
              </Label>
              <Input
                id="google-redirect-url"
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
                  disabled={
                    connect.isPending ||
                    selected.length === 0 ||
                    !redirectUrl.trim()
                  }
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
