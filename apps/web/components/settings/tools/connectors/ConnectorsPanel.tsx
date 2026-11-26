"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
const SENDING_VALUES = ["ask", "without-asking"] as const;

export function ConnectorsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const { data: integrations, isPending, error } = useIntegrations();
  const google = integrations?.filter(({ provider }) => provider === "google");

  return (
    <SettingsSection
      title={t("tools.connectors.title")}
      description={t("tools.connectors.description")}
    >
      {isPending ? (
        <SettingsNotice className="py-6">
          {t("tools.connectors.loading")}
        </SettingsNotice>
      ) : error || !google?.length ? (
        <SettingsNotice tone="error" className="py-6">
          {getErrorMessage(error, t("tools.connectors.loadError"))}
        </SettingsNotice>
      ) : (
        <GoogleAccount integrations={google} isAdmin={isAdmin} />
      )}
    </SettingsSection>
  );
}

function StatusPill({ needsReconnect }: { needsReconnect: boolean }) {
  const { t } = useTranslation();
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
      {needsReconnect
        ? t("tools.connectors.status.signInEnded")
        : t("tools.connectors.status.connected")}
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
  const { t } = useTranslation();
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
      toast.success({ title: t("tools.connectors.google.disconnectedTitle") });
    } catch (error) {
      toast.error({
        title: t("tools.connectors.google.disconnectErrorTitle"),
        description: getErrorMessage(
          error,
          t("tools.connectors.google.disconnectErrorFallback"),
        ),
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
              {/* eslint-disable-next-line i18next/no-literal-string -- provider name */}
              {"Google"}
              {configured && account && (
                <StatusPill needsReconnect={needsReconnect} />
              )}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {!configured
                ? isAdmin
                  ? t("tools.connectors.google.unconfiguredAdmin")
                  : t("tools.connectors.google.unconfiguredUser")
                : needsReconnect
                  ? t("tools.connectors.google.needsReconnect", {
                      email: account.accountEmail,
                    })
                  : account
                    ? account.accountEmail
                    : t("tools.connectors.google.signInOnce", {
                        services: integrationNames(all),
                      })}
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
              {disconnect.isPending
                ? t("tools.connectors.google.disconnecting")
                : t("tools.connectors.google.disconnect")}
            </Button>
          )}
          {configured && account && !needsReconnect && all.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConnecting(coveredIds)}
            >
              {t("tools.connectors.google.changeAccess")}
            </Button>
          )}
          {configured && (!account || needsReconnect) && (
            <Button
              type="button"
              size="sm"
              onClick={() => setConnecting(account ? coveredIds : all)}
            >
              {needsReconnect
                ? t("tools.connectors.google.reconnect")
                : t("tools.connectors.google.connect")}
            </Button>
          )}
          {isAdmin &&
            (configured ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("tools.connectors.google.accessSettings")}
                title={t("tools.connectors.google.accessSettings")}
                onClick={() => setSettingUp(true)}
              >
                <Settings2 />
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setSettingUp(true)}>
                {t("tools.connectors.google.setUp")}
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
  const { t } = useTranslation();
  const { name, Logo } = INTEGRATION_DISPLAY[integration.id];
  const description = t(
    `tools.connectors.integrations.${integration.id}.description`,
  );
  const toolAccess = t(
    `tools.connectors.integrations.${integration.id}.toolAccess`,
  );
  const setSettings = useSetIntegrationSettings(integration.id);
  const { connection } = integration;
  const left = !connection && onAdd;
  const usable = connection?.status === "connected";
  const sendingOptions = SENDING_VALUES.map((value) => ({
    value,
    label: (
      <span className="whitespace-nowrap">
        {value === "ask"
          ? t("tools.connectors.row.askFirst")
          : t("tools.connectors.row.withoutAsking")}
      </span>
    ),
  }));
  async function onSettings(settings: {
    alwaysOn?: boolean;
    sendWithoutAsking?: boolean;
  }) {
    try {
      await setSettings.mutateAsync(settings);
    } catch (error) {
      toast.error({
        title: t("tools.connectors.row.updateErrorTitle", { name }),
        description: getErrorMessage(
          error,
          t("tools.connectors.row.updateErrorFallback"),
        ),
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
              ? t("tools.connectors.row.notPartOfSignIn")
              : usable
                ? toolAccess
                : description}
          </p>
        </div>
      </div>
      {usable && (
        <ToolAccessChoice
          label={t("tools.connectors.row.toolAccessLabel", { name })}
          alwaysOn={connection.alwaysOn}
          disabled={setSettings.isPending}
          onChange={(alwaysOn) => void onSettings({ alwaysOn })}
        />
      )}
      {left && (
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          {t("tools.connectors.row.add")}
        </Button>
      )}
      {usable && SENDING_INTEGRATION_IDS.includes(integration.id) && (
        <>
          <div className="min-w-0 pl-[26px]">
            <p className="text-sm font-medium">
              {t("tools.connectors.row.sendingTitle")}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {connection.sendWithoutAsking
                ? t("tools.connectors.row.sendingWithoutAskingDescription")
                : t("tools.connectors.row.sendingAskFirstDescription")}
            </p>
          </div>
          <SettingsChoiceGroup
            label={t("tools.connectors.row.sendingLabel", { name })}
            value={connection.sendWithoutAsking ? "without-asking" : "ask"}
            onValueChange={(value) =>
              void onSettings({ sendWithoutAsking: value === "without-asking" })
            }
            options={sendingOptions}
            disabled={setSettings.isPending}
            className="w-auto auto-cols-auto"
          />
        </>
      )}
    </li>
  );
}
