"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
            {t("tools.connectors.googleAccess.title")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            <Trans
              i18nKey="tools.connectors.googleAccess.description"
              components={{
                guide: (
                  <a
                    href={SETUP_GUIDE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline underline-offset-4"
                  />
                ),
              }}
            />
          </Dialog.Description>
          {error ? (
            <SettingsNotice tone="error" className="mt-5">
              {getErrorMessage(
                error,
                t("tools.connectors.googleAccess.loadError"),
              )}
            </SettingsNotice>
          ) : client ? (
            <GoogleAccessForm client={client} onClose={onClose} />
          ) : (
            <SettingsNotice className="mt-5">
              {t("common.states.loading")}
            </SettingsNotice>
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
  const { t } = useTranslation();
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
      toast.success({ title: t("tools.connectors.googleAccess.savedTitle") });
      onClose();
    } catch (error) {
      setError(
        getErrorMessage(
          error,
          t("tools.connectors.googleAccess.saveErrorFallback"),
        ),
      );
    }
  }

  async function onRemove() {
    if (busy) return;
    setError("");
    try {
      await remove.mutateAsync();
      toast.success({ title: t("tools.connectors.googleAccess.removedTitle") });
      onClose();
    } catch (error) {
      setError(
        getErrorMessage(
          error,
          t("tools.connectors.googleAccess.removeErrorFallback"),
        ),
      );
    }
  }

  if (confirmingRemoval) {
    return (
      <div className="mt-5 space-y-4">
        <p className="text-sm">
          {t("tools.connectors.googleAccess.confirmRemoval")}
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
            {t("common.actions.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => void onRemove()}
          >
            {remove.isPending
              ? t("common.states.removing")
              : t("common.actions.remove")}
          </Button>
        </SettingsActions>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="google-client-id">
          {t("tools.connectors.googleAccess.clientIdLabel")}
        </Label>
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
            {t("tools.connectors.googleAccess.clientIdChangeWarning")}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="google-client-secret">
          {t("tools.connectors.googleAccess.clientSecretLabel")}
        </Label>
        <PasswordInput
          id="google-client-secret"
          autoComplete="off"
          required={!client.clientSecretSet}
          placeholder={
            client.clientSecretSet
              ? t("tools.connectors.googleAccess.clientSecretPlaceholder")
              : ""
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
            {t("common.actions.remove")}
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
            {t("common.actions.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {save.isPending
              ? t("common.states.saving")
              : t("common.actions.save")}
          </Button>
        </div>
      </SettingsActions>
    </form>
  );
}
