"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";
import { GmailLogo } from "@/components/GmailLogo";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import type { Integration } from "@/lib/integrations/schema";
import {
  useDisconnectIntegration,
  useIntegrations,
} from "@/lib/queries/integrations";
import { SettingsNotice, SettingsSection } from "../../SettingsRows";
import { ConnectGmailDialog } from "./ConnectGmailDialog";
import { GoogleAccessDialog } from "./GoogleAccessDialog";

export function ConnectorsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { data: integrations, isPending, error } = useIntegrations();
  const gmail = integrations?.find((integration) => integration.id === "gmail");

  return (
    <SettingsSection
      title="Connectors"
      description="Connect your own accounts so models can work with them in your chats."
    >
      {isPending ? (
        <SettingsNotice className="py-6">Loading connectors…</SettingsNotice>
      ) : error || !gmail ? (
        <SettingsNotice tone="error" className="py-6">
          {getErrorMessage(error, "Unable to load connectors.")}
        </SettingsNotice>
      ) : (
        <GmailRow integration={gmail} isAdmin={isAdmin} />
      )}
    </SettingsSection>
  );
}

function StatusPill({ needsReconnect }: { needsReconnect: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-card/60 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-muted-foreground">
      <span
        aria-hidden
        className={
          needsReconnect
            ? "size-1.5 rounded-full bg-destructive"
            : "size-1.5 rounded-full bg-emerald-500"
        }
      />
      {needsReconnect ? "Sign-in ended" : "Connected"}
    </span>
  );
}

function GmailRow({
  integration,
  isAdmin,
}: {
  integration: Integration;
  isAdmin: boolean;
}) {
  const disconnect = useDisconnectIntegration("gmail");
  const [connecting, setConnecting] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const { configured, connection } = integration;
  const needsReconnect = connection?.status === "needs_reconnect";

  async function onDisconnect() {
    try {
      await disconnect.mutateAsync();
      toast.success({ title: "Gmail disconnected" });
    } catch (error) {
      toast.error({
        title: "Failed to disconnect Gmail",
        description: getErrorMessage(error, "The account is still connected."),
      });
    }
  }

  return (
    <div className="grid gap-3 py-4 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
          <GmailLogo className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            Gmail
            {configured && connection && (
              <StatusPill needsReconnect={needsReconnect} />
            )}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {!configured
              ? isAdmin
                ? "Set up Google access for this server before anyone can connect."
                : "Not set up on this server. Ask an administrator to set up Google access."
              : needsReconnect
                ? `Google ended access for ${connection.accountEmail}. Reconnect to keep using it.`
                : connection
                  ? connection.accountEmail
                  : "Let models search, read and organize your mail, and write drafts for you to send."}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {configured && connection && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            disabled={disconnect.isPending}
            onClick={() => void onDisconnect()}
          >
            {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
          </Button>
        )}
        {configured && (!connection || needsReconnect) && (
          <Button type="button" size="sm" onClick={() => setConnecting(true)}>
            {needsReconnect ? "Reconnect" : "Connect"}
          </Button>
        )}
        {isAdmin &&
          (configured ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Google access settings"
              title="Google access settings"
              onClick={() => setSettingUp(true)}
            >
              <Settings2 />
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => setSettingUp(true)}>
              Set up
            </Button>
          ))}
      </div>

      {connecting && <ConnectGmailDialog onClose={() => setConnecting(false)} />}
      {settingUp && <GoogleAccessDialog onClose={() => setSettingUp(false)} />}
    </div>
  );
}
