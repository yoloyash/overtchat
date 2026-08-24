"use client";

import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderInput,
  FolderPlus,
  Loader2,
  PencilLine,
  Server,
  Wifi,
} from "lucide-react";
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
  AGENT_PROVIDERS,
  agentDiscoveryTargetSchema,
  agentProviderMetadata,
  type AgentConnectionListItem,
  type AgentDiscoveryTarget,
  type AgentProviderId,
  type AgentSshHostCandidate,
  type DetectedAgentInstallation,
  type HostConnectorListItem,
} from "@overtchat/agent-bridge";
import { agentConnectionMatchesTarget } from "@/lib/agents/workspaces";
import {
  useAgentSshHosts,
  useAgentTargetDirectories,
  useCreateAgentWorkspaceGroup,
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

export function AddAgentWorkspaceDialog({
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
  const createMutation = useCreateAgentWorkspaceGroup();
  const [transport, setTransport] = useState<Transport>("local");
  const [remoteMode, setRemoteMode] = useState<RemoteMode>("detected");
  const [selectedSshAlias, setSelectedSshAlias] = useState<string | null>(null);
  const [manualSshAlias, setManualSshAlias] = useState("");
  const [manualPathEntry, setManualPathEntry] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [browsePath, setBrowsePath] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customProvider, setCustomProvider] = useState<AgentProviderId>("pi");
  const [customExecutable, setCustomExecutable] = useState("pi");
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

  const selectingSshHost = transport === "ssh" && selectedSshAlias === null;
  const sshHosts = useAgentSshHosts(
    connector.id,
    open && selectingSshHost && remoteMode === "detected",
  );
  const directories = useAgentTargetDirectories(
    target,
    browsePath,
    open && target !== null && !manualPathEntry,
  );
  const discovery = useDetectedAgentInstallations(target, open && target !== null);
  const chosenPath = manualPathEntry
    ? manualPath.trim()
    : directories.data?.path;
  const targetConnections = target
    ? connections.filter((connection) =>
        agentConnectionMatchesTarget(connection, target, connection.provider),
      )
    : [];
  const alreadyAttached = Boolean(
    chosenPath &&
      targetConnections.some((connection) =>
        connection.workspaces.some((workspace) => workspace.path === chosenPath),
      ),
  );
  const availableProviders = new Set([
    ...targetConnections.map((connection) => connection.provider),
    ...(discovery.data ?? []).map((installation) => installation.provider),
    ...(customOpen && customExecutable.trim() ? [customProvider] : []),
  ]);
  const pending = createMutation.isPending;

  function resetTargetDetails() {
    setManualPathEntry(false);
    setManualPath("");
    setBrowsePath("");
    setCustomOpen(false);
    setError("");
  }

  function reset() {
    setTransport("local");
    setRemoteMode("detected");
    setSelectedSshAlias(null);
    setManualSshAlias("");
    resetTargetDetails();
    setCustomProvider("pi");
    setCustomExecutable("pi");
    createMutation.reset();
  }

  function changeTransport(next: Transport) {
    setTransport(next);
    setRemoteMode("detected");
    setSelectedSshAlias(null);
    setManualSshAlias("");
    resetTargetDetails();
  }

  function selectSshHost(host: AgentSshHostCandidate) {
    setSelectedSshAlias(host.alias);
    resetTargetDetails();
  }

  function showSshHosts() {
    setRemoteMode("detected");
    setSelectedSshAlias(null);
    setManualSshAlias("");
    resetTargetDetails();
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
    resetTargetDetails();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target) {
      setError("Choose a machine first.");
      return;
    }
    if (!chosenPath) {
      setError("Choose a project folder.");
      return;
    }
    if (!chosenPath.startsWith("/")) {
      setError("Enter an absolute directory path.");
      return;
    }
    if (alreadyAttached) {
      setError("That directory is already in Agent workspaces.");
      return;
    }
    const installations = [...(discovery.data ?? [])];
    if (customOpen && customExecutable.trim()) {
      const customInstallation: DetectedAgentInstallation = {
        provider: customProvider,
        executable: customExecutable.trim(),
        version: "configured",
      };
      const index = installations.findIndex(
        (installation) => installation.provider === customProvider,
      );
      if (index === -1) installations.push(customInstallation);
      else installations[index] = customInstallation;
    }

    setError("");
    try {
      const result = await createMutation.mutateAsync({
        target,
        path: chosenPath,
        connections,
        installations,
      });
      const providerCount = result.created + result.refreshed;
      if (result.failures.length > 0) {
        toast.warning({
          title: "Workspace added with some agent errors",
          description: `${providerCount} agent${providerCount === 1 ? "" : "s"} connected; ${result.failures.length} failed.`,
        });
      } else {
        toast.success({
          title: "Agent workspace added",
          description: `${providerCount} agent${providerCount === 1 ? "" : "s"} discovered and synced.`,
        });
      }
      reset();
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The agent workspace could not be added.",
      );
    }
  }

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
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Add workspace
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Choose a project directory. Available agents and their chats are
            discovered automatically.
          </Dialog.Description>

          <form onSubmit={submit} className="mt-5 space-y-5">
            <SetupSection
              number="1"
              title="Machine"
              description="Where the project is located"
            >
              <RadioGroup
                aria-label="Workspace machine"
                value={transport}
                disabled={pending}
                onValueChange={(next) => changeTransport(next as Transport)}
                className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1"
              >
                <TransportChoice value="local" label="This server" icon={Server} />
                <TransportChoice value="ssh" label="SSH host" icon={Wifi} />
              </RadioGroup>

              {selectingSshHost && remoteMode === "detected" && (
                <div className="mt-3">
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
                    onAddManually={() => {
                      setRemoteMode("manual");
                      setManualSshAlias("");
                      setError("");
                    }}
                  />
                </div>
              )}

              {selectingSshHost && remoteMode === "manual" && (
                <div className="mt-3 space-y-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2"
                    disabled={pending}
                    onClick={showSshHosts}
                  >
                    <ChevronLeft /> SSH config
                  </Button>
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Label htmlFor="agent-workspace-ssh-alias">SSH alias</Label>
                      <Input
                        id="agent-workspace-ssh-alias"
                        value={manualSshAlias}
                        onChange={(event) => {
                          setManualSshAlias(event.target.value);
                          setError("");
                        }}
                        placeholder="devbox"
                        className="font-mono"
                        autoComplete="off"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={submitManualHost}
                    >
                      Use host
                    </Button>
                  </div>
                </div>
              )}

              {target?.transport === "ssh" && (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2"
                    disabled={pending}
                    onClick={showSshHosts}
                  >
                    <ChevronLeft /> Change host
                  </Button>
                  <code className="truncate text-xs text-muted-foreground">
                    ssh {target.sshAlias}
                  </code>
                </div>
              )}
            </SetupSection>

            <SetupSection
              number="2"
              title="Project folder"
              description="The workspace shown in the sidebar"
              disabled={!target}
            >
              <DirectoryPicker
                manualEntry={manualPathEntry}
                manualPath={manualPath}
                browsePath={directories.data?.path}
                parent={directories.data?.parent}
                directories={directories.data?.directories ?? []}
                loading={directories.isFetching && !directories.data}
                fetching={directories.isFetching}
                error={
                  directories.error instanceof Error
                    ? directories.error.message
                    : undefined
                }
                disabled={pending || !target}
                onManualPathChange={(value) => {
                  setManualPath(value);
                  setError("");
                }}
                onBrowse={(path) => {
                  setBrowsePath(path);
                  setError("");
                }}
                onToggleManual={() => {
                  if (!manualPathEntry) {
                    setManualPath(directories.data?.path ?? "");
                  }
                  setManualPathEntry((current) => !current);
                  setError("");
                }}
              />
            </SetupSection>

            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Agents are automatic</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {discovery.isLoading
                      ? "Detecting supported agents…"
                      : availableProviders.size > 0
                        ? `${availableProviders.size} agent${availableProviders.size === 1 ? "" : "s"} will be connected and synced.`
                        : "No supported agents detected yet."}
                  </p>
                </div>
                {!customOpen && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending || !target}
                    onClick={() => {
                      setCustomOpen(true);
                      setError("");
                    }}
                  >
                    <PencilLine /> Configure manually
                  </Button>
                )}
              </div>
              {availableProviders.size > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...availableProviders].map((provider) => (
                    <span
                      key={provider}
                      className="rounded-full border bg-background px-2 py-0.5 text-xs"
                    >
                      {agentProviderMetadata(provider).label}
                    </span>
                  ))}
                </div>
              )}
              {discovery.error instanceof Error && (
                <p className="mt-2 text-xs text-destructive">
                  {discovery.error.message}
                </p>
              )}
              {customOpen && (
                <div className="mt-3 space-y-4 border-t pt-3">
                  <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-agent-provider">Agent</Label>
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
                        <SelectTrigger id="workspace-agent-provider" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.values(AGENT_PROVIDERS).map((provider) => (
                            <SelectItem key={provider.id} value={provider.id}>
                              {provider.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-agent-executable">
                        Executable command or path
                      </Label>
                      <Input
                        id="workspace-agent-executable"
                        value={customExecutable}
                        onChange={(event) => {
                          setCustomExecutable(event.target.value);
                          setError("");
                        }}
                        className="font-mono"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2"
                    disabled={pending}
                    onClick={() => {
                      setCustomOpen(false);
                      setError("");
                    }}
                  >
                    <ChevronLeft /> Use automatic detection
                  </Button>
                </div>
              )}
            </div>

            {alreadyAttached && (
              <SettingsNotice>
                That directory is already in Agent workspaces.
              </SettingsNotice>
            )}
            {error && <SettingsNotice tone="error">{error}</SettingsNotice>}

            <SettingsActions className="items-center justify-between">
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {chosenPath || "Choose a project folder"}
              </span>
              <div className="flex shrink-0 items-center gap-2">
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
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    pending ||
                    !target ||
                    !chosenPath ||
                    discovery.isLoading ||
                    availableProviders.size === 0 ||
                    alreadyAttached
                  }
                >
                  {pending ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <FolderPlus />
                  )}
                  Add workspace
                </Button>
              </div>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SetupSection({
  number,
  title,
  description,
  disabled = false,
  children,
}: {
  number: string;
  title: string;
  description: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-2 border-t pt-4", disabled && "opacity-50")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>
          {number}. {title}
        </Label>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      {children}
    </section>
  );
}

function DirectoryPicker({
  manualEntry,
  manualPath,
  browsePath,
  parent,
  directories,
  loading,
  fetching,
  error,
  disabled,
  onManualPathChange,
  onBrowse,
  onToggleManual,
}: {
  manualEntry: boolean;
  manualPath: string;
  browsePath?: string;
  parent?: string | null;
  directories: Array<{ name: string; path: string }>;
  loading: boolean;
  fetching: boolean;
  error?: string;
  disabled: boolean;
  onManualPathChange: (value: string) => void;
  onBrowse: (path: string) => void;
  onToggleManual: () => void;
}) {
  return (
    <div className="space-y-2">
      {manualEntry ? (
        <Input
          aria-label="Directory path"
          value={manualPath}
          onChange={(event) => onManualPathChange(event.target.value)}
          placeholder="/home/user/code/project"
          className="font-mono"
          spellCheck={false}
          disabled={disabled}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex min-h-10 items-center gap-1 border-b bg-muted/20 px-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || !parent || fetching}
              onClick={() => parent && onBrowse(parent)}
              aria-label="Open parent directory"
              title="Open parent directory"
            >
              <ArrowUp />
            </Button>
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={browsePath}>
              {browsePath || (disabled ? "Choose a machine first" : "Loading directory")}
            </span>
          </div>
          <div className="max-h-52 min-h-32 overflow-y-auto p-1">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
              </div>
            ) : error ? (
              <p className="px-3 py-12 text-center text-xs text-destructive">{error}</p>
            ) : disabled ? (
              <p className="px-3 py-12 text-center text-xs text-muted-foreground">
                Choose a machine to browse its folders
              </p>
            ) : directories.length === 0 ? (
              <p className="px-3 py-12 text-center text-xs text-muted-foreground">
                No subdirectories
              </p>
            ) : (
              directories.map((directory) => (
                <button
                  key={directory.path}
                  type="button"
                  disabled={disabled}
                  onClick={() => onBrowse(directory.path)}
                  className="flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm motion-colors hover:bg-muted disabled:pointer-events-none"
                  title={directory.path}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{directory.name}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2"
        disabled={disabled}
        onClick={onToggleManual}
      >
        {manualEntry ? <FolderInput /> : <PencilLine />}
        {manualEntry ? "Browse folders" : "Enter path"}
      </Button>
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
    <Label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground motion-colors outline-none has-data-[checked]:bg-background has-data-[checked]:text-foreground has-data-[checked]:shadow-xs has-focus-visible:ring-3 has-focus-visible:ring-ring/50 not-has-data-[checked]:hover:text-foreground sm:px-3 sm:text-sm">
      <RadioGroupItem value={value} className="sr-only" />
      <Icon className="size-3.5" />
      <span className="whitespace-nowrap">{label}</span>
    </Label>
  );
}
