"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";
import { GoogleLogo } from "@/components/GoogleLogo";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import {
  SENDING_INTEGRATION_IDS,
  type Integration,
  type IntegrationId,
} from "@/lib/integrations/schema";
import {
  useDisconnectIntegrationAccount,
  useIntegrations,
  useSetIntegrationSettings,
} from "@/lib/queries/integrations";
import { SettingsChoiceGroup } from "../../SettingsChoiceGroup";
import { SettingsNotice, SettingsSection } from "../../SettingsRows";
import { ConnectGoogleDialog } from "./ConnectGoogleDialog";
import { GoogleAccessDialog } from "./GoogleAccessDialog";
import { ToolAccessChoice } from "../ToolAccessChoice";
import { INTEGRATION_DISPLAY, integrationNames } from "./integration-display";

/**
 * Who sends an email a model wrote. "Ask first", the default, leaves it to
 * the user and the email's Send button; "Without asking" also gives a model a
 * tool that sends. The stored setting is a boolean (`sendWithoutAsking`).
 */
const SENDING_OPTIONS = [
  {
    value: "ask",
    label: <span className="whitespace-nowrap">Ask first</span>,
  },
  {
    value: "without-asking",
    label: <span className="whitespace-nowrap">Without asking</span>,
  },
] as const;

export function ConnectorsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { data: integrations, isPending, error } = useIntegrations();
  const google = integrations?.filter(({ provider }) => provider === "google");

  return (
    <SettingsSection
      title="Connectors"
      description="Connect your own accounts so models can work with them in your chats. On demand tool access is recommended."
    >
      {isPending ? (
        <SettingsNotice className="py-6">Loading connectors…</SettingsNotice>
      ) : error || !google?.length ? (
        <SettingsNotice tone="error" className="py-6">
          {getErrorMessage(error, "Unable to load connectors.")}
        </SettingsNotice>
      ) : (
        <GoogleAccount integrations={google} isAdmin={isAdmin} />
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

/** One Google sign-in, and the connectors it does and does not cover. */
function GoogleAccount({
  integrations,
  isAdmin,
}: {
  integrations: Integration[];
  isAdmin: boolean;
}) {
  const disconnect = useDisconnectIntegrationAccount("google");
  // What the sign-in dialog starts with, while it is open.
  const [connecting, setConnecting] = useState<IntegrationId[] | null>(null);
  const [settingUp, setSettingUp] = useState(false);

  const all = integrations.map(({ id }) => id);
  const covered = integrations.filter(({ connection }) => connection);
  const coveredIds = covered.map(({ id }) => id);
  const account = covered[0]?.connection ?? null;
  const configured = integrations[0].configured;
  const needsReconnect = account?.status === "needs_reconnect";

  async function onDisconnect() {
    try {
      await disconnect.mutateAsync();
      toast.success({ title: "Google disconnected" });
    } catch (error) {
      toast.error({
        title: "Failed to disconnect Google",
        description: getErrorMessage(error, "The account is still connected."),
      });
    }
  }

  return (
    <div className="py-4">
      <div className="grid gap-3 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
            <GoogleLogo className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              Google
              {configured && account && (
                <StatusPill needsReconnect={needsReconnect} />
              )}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {!configured
                ? isAdmin
                  ? "Set up Google access for this server before anyone can connect."
                  : "Not set up on this server. Ask an administrator to set up Google access."
                : needsReconnect
                  ? `Google ended access for ${account.accountEmail}. Reconnect to keep using it.`
                  : account
                    ? account.accountEmail
                    : `Sign in once to connect ${integrationNames(all)}.`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {configured && account && (
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
          {configured && account && !needsReconnect && all.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConnecting(coveredIds)}
            >
              Change access
            </Button>
          )}
          {configured && (!account || needsReconnect) && (
            <Button
              type="button"
              size="sm"
              onClick={() => setConnecting(account ? coveredIds : all)}
            >
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
      </div>

      {configured && (
        <ul className="mt-3 space-y-3 pl-12">
          {integrations.map((integration) => (
            <IntegrationRow
              key={integration.id}
              integration={integration}
              // A sign-in that leaves one out can be widened to include it.
              onAdd={
                account && !needsReconnect
                  ? () => setConnecting([...coveredIds, integration.id])
                  : undefined
              }
            />
          ))}
        </ul>
      )}

      {connecting && (
        <ConnectGoogleDialog
          initial={connecting}
          onClose={() => setConnecting(null)}
        />
      )}
      {settingUp && <GoogleAccessDialog onClose={() => setSettingUp(false)} />}
    </div>
  );
}

function IntegrationRow({
  integration,
  onAdd,
}: {
  integration: Integration;
  onAdd?: () => void;
}) {
  const { name, Logo, description, toolAccess } =
    INTEGRATION_DISPLAY[integration.id];
  const setSettings = useSetIntegrationSettings(integration.id);
  const { connection } = integration;
  const left = !connection && onAdd;
  const usable = connection?.status === "connected";

  async function onSettings(settings: {
    alwaysOn?: boolean;
    sendWithoutAsking?: boolean;
  }) {
    try {
      await setSettings.mutateAsync(settings);
    } catch (error) {
      toast.error({
        title: `Failed to change ${name}`,
        description: getErrorMessage(error, "The setting was not saved."),
      });
    }
  }

  return (
    <li
      aria-label={name}
      className="grid gap-2 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-center"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Logo className="mt-1 size-4" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {left
              ? "Not part of this sign-in."
              : usable
                ? toolAccess
                : description}
          </p>
        </div>
      </div>
      {usable && (
        <ToolAccessChoice
          label={`${name} tool access`}
          alwaysOn={connection.alwaysOn}
          disabled={setSettings.isPending}
          onChange={(alwaysOn) => void onSettings({ alwaysOn })}
        />
      )}
      {left && (
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          Add
        </Button>
      )}
      {usable && SENDING_INTEGRATION_IDS.includes(integration.id) && (
        <>
          <div className="min-w-0 pl-[26px]">
            <p className="text-sm font-medium">Sending</p>
            <p className="text-xs leading-5 text-muted-foreground">
              {connection.sendWithoutAsking
                ? "A model can send email as you without asking. Mail it reads can try to trick it into sending."
                : "A model writes an email and you send it."}
            </p>
          </div>
          <SettingsChoiceGroup
            label={`${name} sending`}
            value={connection.sendWithoutAsking ? "without-asking" : "ask"}
            onValueChange={(value) =>
              void onSettings({ sendWithoutAsking: value === "without-asking" })
            }
            options={SENDING_OPTIONS}
            disabled={setSettings.isPending}
            className="w-auto auto-cols-auto"
          />
        </>
      )}
    </li>
  );
}
