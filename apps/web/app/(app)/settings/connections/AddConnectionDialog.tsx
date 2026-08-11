"use client";

import Image, { type StaticImageData } from "next/image";
import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  Check,
  ChevronLeft,
  Loader2,
  PencilLine,
  RefreshCw,
  Server,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import codexIcon from "@/assets/agent-providers/codex.png";
import ompIcon from "@/assets/agent-providers/omp.svg";
import piIcon from "@/assets/agent-providers/pi.svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import {
  agentDiscoveryTargetSchema,
  type AgentConnectionDraft,
  type AgentConnectionListItem,
  type AgentDiscoveryTarget,
  type AgentProviderId,
  type AgentSshHostCandidate,
  type DetectedAgentInstallation,
  type HostConnectorListItem,
} from "@overtchat/agent-bridge";
import {
  AGENT_PROVIDERS,
  agentProviderMetadata,
} from "@overtchat/agent-bridge";
import {
  useAgentSshHosts,
  useCreateAgentConnection,
  useDetectedAgentInstallations,
} from "@/lib/queries/agentConnections";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  SettingsActions,
  SettingsNotice,
} from "../_components/SettingsRows";
import { SshHostPicker } from "./SshHostPicker";

type Transport = "local" | "ssh";
type RemoteMode = "detected" | "manual";

const PROVIDER_ICONS: Record<
  AgentProviderId,
  { icon: StaticImageData; darkSurface?: boolean }
> = {
  pi: { icon: piIcon },
  omp: { icon: ompIcon, darkSurface: true },
  codex: { icon: codexIcon, darkSurface: true },
};

export function AddConnectionDialog({
  connector,
  connections,
  open,
  onOpenChange,
}: {
  connector: HostConnectorListItem;
  connections: AgentConnectionListItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMutation = useCreateAgentConnection();
  const [transport, setTransport] = useState<Transport>("local");
  const [remoteMode, setRemoteMode] = useState<RemoteMode>("detected");
  const [selectedSshAlias, setSelectedSshAlias] = useState<string | null>(null);
  const [manualSshAlias, setManualSshAlias] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customProvider, setCustomProvider] =
    useState<AgentProviderId>("pi");
  const [customExecutable, setCustomExecutable] = useState("pi");
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const target = useMemo<AgentDiscoveryTarget | null>(() => {
    if (transport === "local") {
      return { connectorId: connector.id, transport: "local" };
    }
    return selectedSshAlias
      ? {
          connectorId: connector.id,
          transport: "ssh",
          sshAlias: selectedSshAlias,
        }
      : null;
  }, [connector.id, selectedSshAlias, transport]);

  const sshHosts = useAgentSshHosts(
    connector.id,
    open &&
      transport === "ssh" &&
      selectedSshAlias === null &&
      remoteMode === "detected",
  );
  const discovery = useDetectedAgentInstallations(target, open);
  const pending = createMutation.isPending;

  function reset() {
    setTransport("local");
    setRemoteMode("detected");
    setSelectedSshAlias(null);
    setManualSshAlias("");
    setCustomOpen(false);
    setCustomProvider("pi");
    setCustomExecutable("pi");
    setConnectingKey(null);
    setError("");
    createMutation.reset();
  }

  function changeTransport(value: Transport) {
    setTransport(value);
    setRemoteMode("detected");
    setSelectedSshAlias(null);
    setManualSshAlias("");
    setCustomOpen(false);
    setError("");
  }

  function selectSshHost(host: AgentSshHostCandidate) {
    setSelectedSshAlias(host.alias);
    setCustomOpen(false);
    setError("");
  }

  function showManualHost() {
    setRemoteMode("manual");
    setManualSshAlias("");
    setError("");
  }

  function showSshHosts() {
    setRemoteMode("detected");
    setSelectedSshAlias(null);
    setManualSshAlias("");
    setCustomOpen(false);
    setError("");
  }

  function submitManualHost() {
    const parsed = agentDiscoveryTargetSchema.safeParse({
      connectorId: connector.id,
      transport: "ssh",
      sshAlias: manualSshAlias,
    });
    if (!parsed.success || parsed.data.transport !== "ssh") {
      setError(
        parsed.error?.issues[0]?.message ?? "Enter a valid SSH host alias.",
      );
      return;
    }
    setSelectedSshAlias(parsed.data.sshAlias);
    setCustomOpen(false);
    setError("");
  }

  function isConnected(provider: AgentProviderId): boolean {
    if (!target) return false;
    return connections.some(
      (connection) =>
        connection.provider === provider &&
        connection.host.connectorId === target.connectorId &&
        connection.host.transport === target.transport &&
        (target.transport === "local" ||
          connection.host.sshAlias === target.sshAlias),
    );
  }

  async function connect(
    provider: AgentProviderId,
    executable: string,
  ): Promise<void> {
    const trimmedExecutable = executable.trim();
    if (!target) {
      setError("Choose a machine first.");
      return;
    }
    if (!trimmedExecutable) {
      setError("Enter an executable command or absolute path.");
      return;
    }
    const draft: AgentConnectionDraft =
      target.transport === "local"
        ? {
            connectorId: target.connectorId,
            provider,
            transport: "local",
            name: "This server",
            executable: trimmedExecutable,
          }
        : {
            connectorId: target.connectorId,
            provider,
            transport: "ssh",
            name: target.sshAlias.slice(0, 80),
            executable: trimmedExecutable,
            sshAlias: target.sshAlias,
          };
    const key = `${provider}:${trimmedExecutable}`;
    setConnectingKey(key);
    setError("");
    try {
      const connection = await createMutation.mutateAsync(draft);
      toast.success({
        title: `${agentProviderMetadata(provider).label} added`,
        description: connection.host.name,
      });
      reset();
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The agent could not be added.",
      );
    } finally {
      setConnectingKey(null);
    }
  }

  const selectingSshHost =
    transport === "ssh" && selectedSshAlias === null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) reset();
        if (!pending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Add agent
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Choose where the coding agent is installed.
          </Dialog.Description>

          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label>Location</Label>
              <RadioGroup
                aria-label="Connection location"
                value={transport}
                disabled={pending}
                onValueChange={(next) =>
                  changeTransport(next as Transport)
                }
                className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1"
              >
                <TransportChoice
                  value="local"
                  label="This server"
                  icon={Server}
                />
                <TransportChoice value="ssh" label="SSH host" icon={Wifi} />
              </RadioGroup>
            </div>

            {selectingSshHost && remoteMode === "detected" && (
              <SshHostPicker
                hosts={sshHosts.data ?? []}
                selectedAlias={null}
                loading={sshHosts.isLoading}
                refreshing={sshHosts.isFetching}
                disabled={pending}
                error={
                  sshHosts.error instanceof Error
                    ? sshHosts.error.message
                    : undefined
                }
                onSelect={selectSshHost}
                onRefresh={() => void sshHosts.refetch()}
                onAddManually={showManualHost}
              />
            )}

            {selectingSshHost && remoteMode === "manual" && (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitManualHost();
                }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2"
                  disabled={pending}
                  onClick={showSshHosts}
                >
                  <ChevronLeft />
                  SSH config
                </Button>
                <div className="space-y-1.5">
                  <Label htmlFor="agent-ssh-alias">SSH alias</Label>
                  <Input
                    id="agent-ssh-alias"
                    value={manualSshAlias}
                    onChange={(event) => {
                      setManualSshAlias(event.target.value);
                      setError("");
                    }}
                    placeholder="devbox"
                    className="font-mono"
                    autoComplete="off"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={pending}>
                    Find agents
                  </Button>
                </div>
              </form>
            )}

            {target && (
              <>
                {target.transport === "ssh" && (
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-ml-2"
                      disabled={pending}
                      onClick={showSshHosts}
                    >
                      <ChevronLeft />
                      SSH hosts
                    </Button>
                    <code
                      className="truncate text-xs text-muted-foreground"
                      title={`ssh ${target.sshAlias}`}
                    >
                      ssh {target.sshAlias}
                    </code>
                  </div>
                )}

                <DetectedAgents
                  installations={discovery.data ?? []}
                  loading={discovery.isLoading}
                  refreshing={discovery.isFetching}
                  pending={pending}
                  connectingKey={connectingKey}
                  error={
                    discovery.error instanceof Error
                      ? discovery.error.message
                      : undefined
                  }
                  isConnected={isConnected}
                  onConnect={(installation) =>
                    void connect(
                      installation.provider,
                      installation.executable,
                    )
                  }
                  onRefresh={() => void discovery.refetch()}
                />

                {!customOpen ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2"
                    disabled={pending}
                    onClick={() => {
                      setCustomOpen(true);
                      setError("");
                    }}
                  >
                    <PencilLine />
                    Use custom executable
                  </Button>
                ) : (
                  <form
                    className="space-y-4 border-t pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void connect(customProvider, customExecutable);
                    }}
                  >
                    <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                      <div className="space-y-1.5">
                        <Label htmlFor="agent-provider">Agent</Label>
                        <Select
                          value={customProvider}
                          onValueChange={(next) => {
                            const provider = next as AgentProviderId;
                            setCustomProvider(provider);
                            setCustomExecutable(
                              agentProviderMetadata(provider).executable,
                            );
                            setError("");
                          }}
                        >
                          <SelectTrigger
                            id="agent-provider"
                            className="w-full"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.values(AGENT_PROVIDERS).map(
                              (provider) => (
                                <SelectItem
                                  key={provider.id}
                                  value={provider.id}
                                >
                                  {provider.label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="agent-executable">
                          Executable command or path
                        </Label>
                        <Input
                          id="agent-executable"
                          value={customExecutable}
                          onChange={(event) => {
                            setCustomExecutable(event.target.value);
                            setError("");
                          }}
                          className="font-mono"
                          spellCheck={false}
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setCustomOpen(false);
                          setError("");
                        }}
                      >
                        <ChevronLeft />
                        Back
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={
                          pending ||
                          !customExecutable.trim() ||
                          isConnected(customProvider)
                        }
                      >
                        {connectingKey ===
                          `${customProvider}:${customExecutable.trim()}` && (
                          <Loader2 className="animate-spin motion-reduce:animate-none" />
                        )}
                        {isConnected(customProvider)
                          ? "Added"
                          : "Add"}
                      </Button>
                    </div>
                  </form>
                )}
              </>
            )}

            {error && <SettingsNotice tone="error">{error}</SettingsNotice>}

            <SettingsActions>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                Cancel
              </Button>
            </SettingsActions>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetectedAgents({
  installations,
  loading,
  refreshing,
  pending,
  connectingKey,
  error,
  isConnected,
  onConnect,
  onRefresh,
}: {
  installations: DetectedAgentInstallation[];
  loading: boolean;
  refreshing: boolean;
  pending: boolean;
  connectingKey: string | null;
  error?: string;
  isConnected: (provider: AgentProviderId) => boolean;
  onConnect: (installation: DetectedAgentInstallation) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <Label>Available agents</Label>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={pending || refreshing}
          onClick={onRefresh}
          aria-label="Refresh detected agents"
          title="Refresh detected agents"
        >
          <RefreshCw
            className={cn(
              refreshing && "animate-spin motion-reduce:animate-none",
            )}
          />
        </Button>
      </div>
      <div className="min-h-24 overflow-hidden rounded-lg border">
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
          </div>
        ) : error ? (
          <p className="px-4 py-8 text-center text-xs text-destructive">
            {error}
          </p>
        ) : installations.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center px-4 text-center">
            <TerminalSquare className="size-4 text-muted-foreground" />
            <p className="mt-2 text-xs text-muted-foreground">
              No supported agents found in PATH
            </p>
          </div>
        ) : (
          installations.map((installation) => {
            const metadata = agentProviderMetadata(installation.provider);
            const icon = PROVIDER_ICONS[installation.provider];
            const connected = isConnected(installation.provider);
            const key = `${installation.provider}:${installation.executable}`;
            return (
              <div
                key={key}
                className="flex min-h-16 items-center gap-3 border-b px-3 py-2 last:border-b-0"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md border bg-background",
                    icon.darkSurface && "bg-zinc-950",
                  )}
                >
                  <Image
                    src={icon.icon}
                    alt=""
                    className="size-5 object-contain"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">
                      {metadata.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {installation.version}
                    </span>
                  </span>
                  <code
                    className="block truncate text-xs text-muted-foreground"
                    title={installation.executable}
                  >
                    {installation.executable}
                  </code>
                </span>
                <Button
                  type="button"
                  variant={connected ? "outline" : "default"}
                  size="sm"
                  disabled={pending || connected}
                  onClick={() => onConnect(installation)}
                  aria-label={
                    connected
                      ? `${metadata.label} already added`
                      : `Add ${metadata.label}`
                  }
                >
                  {connectingKey === key ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" />
                  ) : connected ? (
                    <Check />
                  ) : null}
                  {connected ? "Added" : "Add"}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function TransportChoice({
  value,
  label,
  icon: Icon,
}: {
  value: string;
  label: string;
  icon: typeof Server;
}) {
  return (
    <Label className="flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground motion-colors outline-none has-data-[checked]:bg-background has-data-[checked]:text-foreground has-data-[checked]:shadow-xs has-focus-visible:ring-3 has-focus-visible:ring-ring/50 not-has-data-[checked]:hover:text-foreground sm:px-3 sm:text-sm">
      <RadioGroupItem value={value} className="sr-only" />
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Icon className="size-3.5" />
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </Label>
  );
}
