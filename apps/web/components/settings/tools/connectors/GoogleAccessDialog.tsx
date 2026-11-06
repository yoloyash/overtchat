"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import type { IntegrationOauthClient } from "@/lib/integrations/schema";
import { motionClasses } from "@/lib/motion";
import {
  useDeleteIntegrationOauthClient,
  useIntegrationOauthClient,
  useSaveIntegrationOauthClient,
} from "@/lib/queries/integrations";
import { cn } from "@/lib/utils";
import { SettingsActions, SettingsNotice } from "../../SettingsRows";

const SETUP_GUIDE_URL =
  "https://github.com/yoloyash/overtchat/blob/main/docs/deploy.md#gmail-and-google-calendar";

/** The server's own Google OAuth client, which every user's sign-in goes through. */
export function GoogleAccessDialog({ onClose }: { onClose: () => void }) {
  const { data: client, error } = useIntegrationOauthClient("google", true);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
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
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Google access
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Everyone on this server signs in to Google through an OAuth client
            from your own Google Cloud project. Create one of type Desktop
            app, enter it here, and add each person&apos;s Google address to
            the project&apos;s test users.{" "}
            <a
              href={SETUP_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4"
            >
              Setup guide
            </a>
          </Dialog.Description>
          {error ? (
            <SettingsNotice tone="error" className="mt-5">
              {getErrorMessage(error, "Unable to load Google access.")}
            </SettingsNotice>
          ) : client ? (
            <GoogleAccessForm client={client} onClose={onClose} />
          ) : (
            <SettingsNotice className="mt-5">Loading…</SettingsNotice>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function GoogleAccessForm({
  client,
  onClose,
}: {
  client: IntegrationOauthClient;
  onClose: () => void;
}) {
  const save = useSaveIntegrationOauthClient("google");
  const remove = useDeleteIntegrationOauthClient("google");
  const [clientId, setClientId] = useState(client.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState("");
  const configured = client.clientId !== null;
  const busy = save.isPending || remove.isPending;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      await save.mutateAsync({ clientId, clientSecret });
      toast.success({ title: "Google access saved" });
      onClose();
    } catch (error) {
      setError(getErrorMessage(error, "Could not save Google access."));
    }
  }

  async function onRemove() {
    if (busy) return;
    setError("");
    try {
      await remove.mutateAsync();
      toast.success({ title: "Google access removed" });
      onClose();
    } catch (error) {
      setError(getErrorMessage(error, "Could not remove Google access."));
    }
  }

  if (confirmingRemoval) {
    return (
      <div className="mt-5 space-y-4">
        <p className="text-sm">
          Remove Google access? Everyone&apos;s Google connection on this server
          will be deleted, and nobody can connect until it is set up again.
        </p>
        {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
        <SettingsActions bordered={false}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setConfirmingRemoval(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => void onRemove()}
          >
            {remove.isPending ? "Removing…" : "Remove"}
          </Button>
        </SettingsActions>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="google-client-id">Client ID</Label>
        <Input
          id="google-client-id"
          autoComplete="off"
          spellCheck={false}
          required
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          disabled={busy}
        />
        {configured && (
          <p className="text-xs leading-5 text-muted-foreground">
            A different client ID disconnects everyone until they sign in
            again.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="google-client-secret">Client secret</Label>
        <PasswordInput
          id="google-client-secret"
          autoComplete="off"
          required={!client.clientSecretSet}
          placeholder={
            client.clientSecretSet ? "Leave empty to keep the stored secret" : ""
          }
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          disabled={busy}
        />
      </div>
      {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
      <SettingsActions bordered={false} className="justify-between pt-2">
        {configured ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            onClick={() => {
              setError("");
              setConfirmingRemoval(true);
            }}
          >
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </SettingsActions>
    </form>
  );
}
