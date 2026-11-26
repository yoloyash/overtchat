"use client";

import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Popover } from "@base-ui/react/popover";
import {
  Check,
  Clipboard,
  ExternalLink,
  Folder,
  Info,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  TerminalSquare,
  Trash2,
  Wifi,
} from "lucide-react";
import { BetaBadge } from "@/components/BetaBadge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type {
  AgentConnectionListItem,
  HostConnectorListItem,
  HostConnectorPairing,
} from "@overtchat/agent-bridge";
import {
  AGENT_PROVIDERS,
  agentProviderMetadata,
} from "@overtchat/agent-bridge";
import {
  agentConnectionTarget,
  groupAgentWorkspaces,
  projectAgentWorkspaceProviders,
  type AgentWorkspaceGroup,
} from "@/lib/agents/workspaces";
import { AGENT_PROVIDER_VISUALS } from "@/lib/agents/providerVisuals";
import {
  useAgentConnections,
  useAgentProviderSnapshot,
  useDeleteHostConnector,
  useDeleteAgentWorkspaceGroup,
  useCreateHostConnectorPairing,
  useHostConnectors,
  useTestAgentConnection,
} from "@/lib/queries/agentConnections";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  SettingsNotice,
  SettingsPage,
  SettingsPageHeader,
  SettingsSection,
} from "../SettingsRows";
import { AgentWorktreeRemovalDetails } from "@/components/agents/AgentWorktreeRemovalDetails";
import { useAgentWorktreeInspection } from "@/lib/queries/agentWorkspaces";
import { AddAgentWorkspaceDialog } from "./AddAgentWorkspaceDialog";

type PendingDetach =
  | { type: "connector"; connector: HostConnectorListItem }
  | { type: "workspace-group"; group: AgentWorkspaceGroup };

export function ConnectionsPanel({
  initialAddOpen = false,
}: {
  initialAddOpen?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: connections = [], error: listError } = useAgentConnections();
  const { data: connectors = [], error: connectorError } = useHostConnectors();
  const connector = connectors[0];
  const workspaceGroups = useMemo(
    () => groupAgentWorkspaces(connections),
    [connections],
  );
  const testMutation = useTestAgentConnection();
  const deleteWorkspaceGroupMutation = useDeleteAgentWorkspaceGroup();
  const pairingMutation = useCreateHostConnectorPairing();
  const deleteConnectorMutation = useDeleteHostConnector();
  const [addOpen, setAddOpen] = useState(initialAddOpen);
  const [pairing, setPairing] = useState<HostConnectorPairing | null>(null);
  const [pairingError, setPairingError] = useState("");
  const [commandCopied, setCommandCopied] = useState(false);
  const [upgradeCopied, setUpgradeCopied] = useState(false);
  const [pendingDetach, setPendingDetach] = useState<PendingDetach | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [detachError, setDetachError] = useState("");

  async function testConnection(connection: AgentConnectionListItem) {
    const provider = agentProviderMetadata(connection.provider);
    setActionId(connection.id);
    try {
      const probe = await testMutation.mutateAsync(connection.id);
      toast.success({
        title: t("connections.toast.testSuccessTitle"),
        description: t("connections.toast.testSuccessDescription", {
          provider: provider.label,
          version: probe.version,
          count: probe.models.length,
        }),
      });
    } catch (cause) {
      toast.error({
        title: t("connections.toast.testErrorTitle"),
        description:
          cause instanceof Error
            ? cause.message
            : t("connections.toast.testErrorFallback"),
      });
    } finally {
      setActionId(null);
    }
  }

  async function confirmDetach() {
    if (!pendingDetach) return;
    setDetachError("");
    try {
      if (pendingDetach.type === "connector") {
        await deleteConnectorMutation.mutateAsync(
          pendingDetach.connector.id,
        );
        setPairing(null);
        toast.success({ title: t("connections.toast.connectorRemoved") });
      } else {
        await deleteWorkspaceGroupMutation.mutateAsync(pendingDetach.group);
        toast.success({
          title: t("connections.toast.workspaceRemoved"),
          description: pendingDetach.group.name,
        });
      }
      setPendingDetach(null);
    } catch (cause) {
      setDetachError(
        cause instanceof Error
          ? cause.message
          : t("connections.toast.detachErrorFallback"),
      );
    }
  }

  const detaching =
    deleteWorkspaceGroupMutation.isPending ||
    deleteConnectorMutation.isPending;

  async function createPairing() {
    setPairingError("");
    try {
      setPairing(await pairingMutation.mutateAsync());
      setCommandCopied(false);
    } catch (cause) {
      // The usual cause is a server-side HOST_CONNECTOR_URL problem, which
      // the operator needs to read in full rather than catch in a toast.
      setPairingError(
        cause instanceof Error
          ? cause.message
          : t("connections.host.pairingErrorFallback"),
      );
    }
  }

  async function copyPairingCommand() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.command);
    setCommandCopied(true);
  }

  async function copyUpgradeCommand() {
    if (!connector?.upgrade) return;
    await navigator.clipboard.writeText(connector.upgrade.command);
    setUpgradeCopied(true);
  }

  const pendingWorktree =
    pendingDetach?.type === "workspace-group"
      ? (pendingDetach.group.targets.find(
          ({ workspace }) => workspace.worktreeParentPath,
        )?.workspace ?? null)
      : null;
  // Removal waits until the dialog can say what would be lost.
  const worktreeInspection = useAgentWorktreeInspection(pendingWorktree?.id ?? "");

  function setAddDialogOpen(open: boolean) {
    setAddOpen(open);
    if (!open && initialAddOpen) {
      void navigate({ to: "/settings/connections", replace: true, resetScroll: false });
    }
  }

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {t("connections.page.title")}
            <BetaBadge className="text-[10px]" />
          </span>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{t("connections.page.description")}</span>
            <span
              className="inline-flex items-center gap-1"
              aria-label={t("connections.page.supportedAgentsLabel", {
                providers: Object.values(AGENT_PROVIDERS)
                  .map((provider) => provider.label)
                  .join(", "),
              })}
            >
              {Object.values(AGENT_PROVIDERS).map((provider) => {
                const visual = AGENT_PROVIDER_VISUALS[provider.id];
                return (
                  <span
                    key={provider.id}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md border bg-background",
                      visual.darkSurface && "bg-zinc-950",
                    )}
                    title={provider.label}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={visual.icon}
                      alt=""
                      className="size-4 object-contain"
                    />
                  </span>
                );
              })}
            </span>
          </span>
        }
        action={
          connector?.online && workspaceGroups.length > 0 ? (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus /> {t("connections.page.addWorkspace")}
            </Button>
          ) : undefined
        }
      />

      <SettingsSection
        title={t("connections.host.title")}
        description={
          connector
            ? connector.online
              ? t("connections.host.statusOnline", { name: connector.name })
              : t("connections.host.statusOffline", { name: connector.name })
            : t("connections.host.notSetUp")
        }
      >
        {connectorError ? (
          <SettingsNotice tone="error" className="py-6">
            {connectorError instanceof Error
              ? connectorError.message
              : t("connections.host.loadError")}
          </SettingsNotice>
        ) : connector ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <span
              className={cn(
                "size-2 rounded-full",
                connector.online ? "bg-emerald-500" : "bg-muted-foreground",
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{connector.name}</p>
              <p className="text-xs text-muted-foreground">
                {connector.version
                  ? t("connections.host.subtitleWithVersion", {
                      version: connector.version,
                    })
                  : t("connections.host.subtitle")}
              </p>
            </div>
            {!connector.online && !connector.managed && (
              <Button
                variant="outline"
                size="sm"
                disabled={pairingMutation.isPending}
                onClick={() => void createPairing()}
              >
                {pairingMutation.isPending ? (
                  <Loader2 className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Link2 />
                )}
                {t("connections.host.pairAgain")}
              </Button>
            )}
            {!connector.managed && (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={deleteConnectorMutation.isPending}
                onClick={() => {
                  setDetachError("");
                  setPendingDetach({ type: "connector", connector });
                }}
                aria-label={t("connections.host.removeConnector")}
                title={t("connections.host.removeConnector")}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30">
                <Server className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {t("connections.host.uninstalledTitle")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("connections.host.uninstalledDescription")}
                </span>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={pairingMutation.isPending}
              onClick={() => void createPairing()}
            >
              {pairingMutation.isPending ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Link2 />
              )}
              {t("connections.host.pairConnector")}
            </Button>
          </div>
        )}
        {pairingError && (
          <SettingsNotice tone="error" className="border-t px-4 py-3 text-xs">
            {pairingError}
          </SettingsNotice>
        )}
        {connector?.upgrade && (
          <div className="border-t px-4 py-4">
            <p className="text-sm font-medium">
              {t("connections.host.upgradeAvailable", {
                version: connector.upgrade.version,
              })}
            </p>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">
              {t("connections.host.upgradeDescription")}
            </p>
            <div className="flex items-center gap-2">
              <code
                aria-label={t("connections.host.upgradeCommandLabel")}
                className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-2 text-xs"
              >
                {connector.upgrade.command}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void copyUpgradeCommand()}
                aria-label={t("connections.host.copyUpgradeCommand")}
                title={t("connections.host.copyUpgradeCommand")}
              >
                {upgradeCopied ? <Check /> : <Clipboard />}
              </Button>
            </div>
          </div>
        )}
        {pairing && !connector && (
          <div className="border-t px-4 py-4">
            <div className="mb-2 flex items-center gap-1">
              <p className="text-sm font-medium">
                {t("connections.host.installTitle")}
              </p>
              <HostConnectorInfo />
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("connections.host.installDescription")}
            </p>
            <div className="flex items-center gap-2">
              <code
                aria-label={t("connections.host.installCommandLabel")}
                className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-2 text-xs"
              >
                {pairing.command}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void copyPairingCommand()}
                aria-label={t("connections.host.copyInstallCommand")}
                title={t("connections.host.copyInstallCommand")}
              >
                {commandCopied ? <Check /> : <Clipboard />}
              </Button>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
              {t("connections.host.waitingForConnection")}
            </div>
          </div>
        )}
      </SettingsSection>

      {connector && (
        <SettingsSection
          title={t("connections.workspaces.title")}
          description={
            workspaceGroups.length > 0
              ? t("connections.workspaces.available", {
                  count: workspaceGroups.length,
                })
              : undefined
          }
        >
          {listError ? (
            <SettingsNotice tone="error" className="py-6">
              {listError instanceof Error
                ? listError.message
                : t("connections.workspaces.loadError")}
            </SettingsNotice>
          ) : workspaceGroups.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Folder className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                {t("connections.workspaces.empty")}
              </p>
              {connector.online && (
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus /> {t("connections.page.addWorkspace")}
                </Button>
              )}
            </div>
          ) : (
            workspaceGroups.map((group) => (
              <WorkspaceGroupRow
                key={group.key}
                group={group}
                actionId={actionId}
                onTest={(connection) => void testConnection(connection)}
                onRemoveWorkspace={() => {
                  setDetachError("");
                  setPendingDetach({
                    type: "workspace-group",
                    group,
                  });
                }}
              />
            ))
          )}
        </SettingsSection>
      )}

      {connector && (
        <AddAgentWorkspaceDialog
          connector={connector}
          connections={connections}
          open={addOpen}
          onOpenChange={setAddDialogOpen}
        />
      )}

      <AlertDialog.Root
        open={pendingDetach !== null}
        onOpenChange={(next) => {
          if (!next && !detaching) {
            setPendingDetach(null);
            setDetachError("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              {pendingDetach?.type === "workspace-group"
                ? pendingWorktree
                  ? t("connections.detachDialog.removeWorktreeTitle")
                  : t("connections.detachDialog.removeWorkspaceTitle")
                : t("connections.detachDialog.removeConnectorTitle")}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              {pendingDetach?.type === "connector" ? (
                <Trans
                  i18nKey="connections.detachDialog.connectorDescription"
                  values={{ name: pendingDetach.connector.name }}
                  components={{
                    name: <span className="font-medium text-foreground" />,
                  }}
                />
              ) : pendingWorktree && pendingDetach?.type === "workspace-group" ? (
                <AgentWorktreeRemovalDetails
                  workspaceId={pendingWorktree.id}
                  name={pendingDetach.group.name}
                />
              ) : pendingDetach?.type === "workspace-group" ? (
                <Trans
                  i18nKey="connections.detachDialog.workspaceDescription"
                  values={{ name: pendingDetach.group.name }}
                  components={{
                    name: <span className="font-medium text-foreground" />,
                  }}
                />
              ) : null}
            </AlertDialog.Description>
            {detachError && (
              <SettingsNotice tone="error" className="mt-3 text-xs">
                {detachError}
              </SettingsNotice>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={
                  <Button variant="ghost" size="sm" disabled={detaching} />
                }
              >
                {t("connections.dialog.cancel")}
              </AlertDialog.Close>
              <Button
                variant="destructive"
                size="sm"
                disabled={detaching || worktreeInspection.isLoading}
                onClick={() => void confirmDetach()}
              >
                {detaching && (
                  <Loader2 className="animate-spin motion-reduce:animate-none" />
                )}
                {t("connections.detachDialog.remove")}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </SettingsPage>
  );
}

function HostConnectorInfo() {
  const { t } = useTranslation();
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={t("connections.host.infoLabel")}
            title={t("connections.host.infoLabel")}
          />
        }
      >
        <Info />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50"
        >
          <Popover.Popup
            className={cn(
              "w-72 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-3 text-xs leading-5 text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <Popover.Title className="font-medium text-foreground">
              {t("connections.host.infoTitle")}
            </Popover.Title>
            <p className="mt-1 text-muted-foreground">
              {t("connections.host.infoDescription")}
            </p>
            <a
              href="https://github.com/yoloyash/overtchat/blob/main/scripts/install-connector.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
            >
              {t("connections.host.viewInstallerSource")}
              <ExternalLink className="size-3" />
            </a>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function WorkspaceGroupRow({
  group,
  actionId,
  onTest,
  onRemoveWorkspace,
}: {
  group: AgentWorkspaceGroup;
  actionId: string | null;
  onTest: (connection: AgentConnectionListItem) => void;
  onRemoveWorkspace: () => void;
}) {
  const { t } = useTranslation();
  const HostIcon = group.host.transport === "local" ? Server : Wifi;
  const hostDetail =
    group.host.transport === "local"
      ? t("connections.dialog.thisServer")
      : `ssh ${group.host.sshAlias}`;
  const sessionCount = group.sessions.length;
  const providerSnapshot = useAgentProviderSnapshot(
    agentConnectionTarget(group.targets[0]!.connection),
  );
  const providers = projectAgentWorkspaceProviders(
    group,
    providerSnapshot.data,
  );

  return (
    <div className="px-4 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30">
          <Folder className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{group.name}</span>
            <span className="text-xs text-muted-foreground">
              {t("connections.workspaces.agentCount", {
                count: providers.length,
              })}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={group.path}>
            {group.path}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <HostIcon className="size-3" /> {hostDetail}
            </span>
            <span>
              {t("connections.workspaces.sessionCount", {
                count: sessionCount,
              })}
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("connections.workspaces.removeWorkspaceLabel", {
            name: group.name,
          })}
          title={t("connections.workspaces.removeWorkspace")}
          onClick={onRemoveWorkspace}
        >
          <Trash2 />
        </Button>
      </div>

      <div className="mt-4 ml-4 border-l pl-4">
        {providers.map(({ provider: providerId }) => {
          const backing = group.targets.find(
            ({ connection }) => connection.provider === providerId,
          );
          const installation = providerSnapshot.data?.providers.find(
            (entry) =>
              entry.provider === providerId && entry.status === "ready",
          );
          const provider = agentProviderMetadata(providerId);
          const executable =
            installation?.status === "ready"
              ? installation.executable
              : backing?.connection.executable;
          const version =
            installation?.status === "ready"
              ? installation.version
              : backing?.connection.detectedVersion;
          const providerSessionCount = group.sessions.filter(
            (session) => session.provider === providerId,
          ).length;
          return (
            <div
              key={providerId}
              className="flex flex-col gap-2 border-b py-3 first:pt-0 last:border-0 last:pb-0 @xl:flex-row @xl:items-center"
            >
              <TerminalSquare className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-sm font-medium">{provider.label}</p>
                  <span className="text-xs text-muted-foreground">
                    {version ?? t("connections.workspaces.notTested")}
                  </span>
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground" title={executable}>
                  {executable}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {t("connections.workspaces.sessionCount", {
                  count: providerSessionCount,
                })}
              </span>
              {backing && (
                <div className="flex items-center gap-1 @xl:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={actionId !== null}
                  aria-label={t("connections.workspaces.testAgentLabel", {
                    provider: provider.label,
                    workspace: group.name,
                  })}
                  title={t("connections.workspaces.testAgent")}
                  onClick={() => onTest(backing.connection)}
                >
                  <RefreshCw
                    className={cn(
                      actionId === backing.connection.id &&
                        "animate-spin motion-reduce:animate-none",
                    )}
                  />
                </Button>
              </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
