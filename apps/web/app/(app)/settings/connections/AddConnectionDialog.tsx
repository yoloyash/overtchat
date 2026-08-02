"use client";

import Image, { type StaticImageData } from "next/image";
import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  CheckCircle2,
  ChevronLeft,
  KeyRound,
  Loader2,
  Monitor,
  Server,
  Wifi,
} from "lucide-react";
import claudeCodeIcon from "@/assets/agent-providers/claude-code.png";
import codexIcon from "@/assets/agent-providers/codex.png";
import ompIcon from "@/assets/agent-providers/omp.svg";
import piIcon from "@/assets/agent-providers/pi.svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type {
  AgentConnectionDraft,
  AgentHostKeyProbe,
  AgentProviderId,
  AgentReadyConnectionProbe,
  AgentSshHostCandidate,
} from "@/lib/agents/types";
import { agentProviderMetadata } from "@/lib/agents/catalog";
import {
  useCreateAgentConnection,
  useAgentSshHosts,
  useProbeAgentConnection,
} from "@/lib/queries/agentConnections";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  SettingsActions,
  SettingsNotice,
} from "../_components/SettingsRows";
import { SshHostPicker } from "./SshHostPicker";

type Transport = "local" | "ssh";
type SshAuth = "agent" | "private_key";
type RemoteMode = "detected" | "manual";

type TestedConnection = {
  signature: string;
  probe: AgentReadyConnectionProbe;
};

export function AddConnectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const initialTransport: Transport = "local";
  const initialAuth: SshAuth = "agent";
  const probeMutation = useProbeAgentConnection();
  const createMutation = useCreateAgentConnection();
  const [selectedProvider, setSelectedProvider] =
    useState<AgentProviderId | null>(null);
  const [transport, setTransport] = useState<Transport>(initialTransport);
  const [remoteMode, setRemoteMode] = useState<RemoteMode>("detected");
  const [selectedSshAlias, setSelectedSshAlias] = useState<string | null>(
    null,
  );
  const [name, setName] = useState(
    initialTransport === "local" ? "This server" : "Remote agent",
  );
  const [executable, setExecutable] = useState("");
  const [hostname, setHostname] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [sshAuth, setSshAuth] = useState<SshAuth>(initialAuth);
  const [privateKey, setPrivateKey] = useState("");
  const [confirmedHostKey, setConfirmedHostKey] = useState("");
  const [pendingHostKey, setPendingHostKey] =
    useState<AgentHostKeyProbe | null>(null);
  const [tested, setTested] = useState<TestedConnection | null>(null);
  const [error, setError] = useState("");
  const sshHosts = useAgentSshHosts(
    open &&
      selectedProvider !== null &&
      transport === "ssh" &&
      remoteMode === "detected",
  );

  function reset() {
    setSelectedProvider(null);
    setTransport(initialTransport);
    setRemoteMode("detected");
    setSelectedSshAlias(null);
    setName(initialTransport === "local" ? "This server" : "Remote agent");
    setExecutable("");
    setHostname("");
    setPort("22");
    setUsername("");
    setSshAuth(initialAuth);
    setPrivateKey("");
    setConfirmedHostKey("");
    setPendingHostKey(null);
    setTested(null);
    setError("");
    probeMutation.reset();
    createMutation.reset();
  }

  function invalidateTest() {
    setTested(null);
    setPendingHostKey(null);
    setConfirmedHostKey("");
    setError("");
  }

  function selectProvider(provider: AgentProviderId) {
    const metadata = agentProviderMetadata(provider);
    invalidateTest();
    setSelectedProvider(provider);
    setName(
      transport === "local" ? "This server" : `Remote ${metadata.label}`,
    );
    setExecutable(metadata.executable);
  }

  function selectSshHost(host: AgentSshHostCandidate) {
    if (!selectedProvider) return;
    invalidateTest();
    setSelectedSshAlias(host.alias);
    setName(host.alias);
    setHostname(host.alias);
    setPort(String(host.port));
    setUsername(host.username);
    setSshAuth("agent");
    setPrivateKey("");
    setExecutable(agentProviderMetadata(selectedProvider).executable);
  }

  function showManualConnection() {
    if (!selectedProvider) return;
    const metadata = agentProviderMetadata(selectedProvider);
    invalidateTest();
    setRemoteMode("manual");
    setSelectedSshAlias(null);
    setName(`Remote ${metadata.label}`);
    setHostname("");
    setPort("22");
    setUsername("");
    setSshAuth(initialAuth);
    setPrivateKey("");
    setExecutable(metadata.executable);
  }

  function showDetectedConnections() {
    if (!selectedProvider) return;
    const metadata = agentProviderMetadata(selectedProvider);
    invalidateTest();
    setRemoteMode("detected");
    setSelectedSshAlias(null);
    setName(`Remote ${metadata.label}`);
    setHostname("");
    setPort("22");
    setUsername("");
    setSshAuth("agent");
    setPrivateKey("");
    setExecutable(metadata.executable);
  }

  function buildDraft(hostKey = confirmedHostKey):
    | { draft: AgentConnectionDraft }
    | { error: string } {
    const trimmedName = name.trim();
    const trimmedExecutable = executable.trim();
    if (!selectedProvider) return { error: "Choose a coding agent." };
    const metadata = agentProviderMetadata(selectedProvider);
    if (!trimmedName) return { error: "Enter a connection name." };
    if (!trimmedExecutable) {
      return { error: `Enter the ${metadata.label} executable path.` };
    }
    if (transport === "local") {
      return {
        draft: {
          provider: selectedProvider,
          transport: "local",
          name: trimmedName,
          executable: trimmedExecutable,
        },
      };
    }

    const parsedPort = Number(port);
    if (!hostname.trim()) return { error: "Enter an SSH hostname." };
    if (!username.trim()) return { error: "Enter an SSH username." };
    if (
      !Number.isInteger(parsedPort) ||
      parsedPort < 1 ||
      parsedPort > 65_535
    ) {
      return { error: "Enter a valid SSH port." };
    }
    if (sshAuth === "private_key" && !privateKey.trim()) {
      return { error: "Paste an SSH private key." };
    }
    return {
      draft: {
        provider: selectedProvider,
        transport: "ssh",
        name: trimmedName,
        executable: trimmedExecutable,
        hostname: hostname.trim(),
        port: parsedPort,
        username: username.trim(),
        sshAuth,
        ...(sshAuth === "private_key"
          ? { privateKey: privateKey.trim() }
          : {}),
        ...(hostKey ? { hostKey } : {}),
      },
    };
  }

  const currentSignature = useMemo(() => {
    const result = buildDraft();
    return "draft" in result ? JSON.stringify(result.draft) : null;
    // Primitive form state is intentionally listed so a successful probe is
    // tied to the exact values that will be saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    confirmedHostKey,
    executable,
    hostname,
    name,
    port,
    privateKey,
    selectedProvider,
    sshAuth,
    transport,
  ]);
  const isTested =
    currentSignature !== null && tested?.signature === currentSignature;
  const pending = probeMutation.isPending || createMutation.isPending;
  const choosingSshHost =
    transport === "ssh" && remoteMode === "detected";

  async function testConnection() {
    const result = buildDraft();
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError("");
    try {
      const probe = await probeMutation.mutateAsync(result.draft);
      if (probe.status === "host_key") {
        setPendingHostKey(probe);
        return;
      }
      setTested({
        signature: JSON.stringify(result.draft),
        probe,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The connection test failed.",
      );
    }
  }

  async function confirmFingerprint() {
    const hostKey = pendingHostKey?.hostKey;
    if (!hostKey) return;
    const result = buildDraft(hostKey);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError("");
    try {
      const probe = await probeMutation.mutateAsync(result.draft);
      if (probe.status !== "ready") {
        throw new Error("The SSH host key could not be confirmed.");
      }
      setConfirmedHostKey(hostKey);
      setTested({
        signature: JSON.stringify(result.draft),
        probe,
      });
      setPendingHostKey(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The connection test failed.",
      );
    }
  }

  async function connect() {
    const result = buildDraft();
    if ("error" in result) {
      setError(result.error);
      return;
    }
    if (tested?.signature !== JSON.stringify(result.draft)) {
      setError("Test this configuration before connecting.");
      return;
    }
    setError("");
    try {
      const connection = await createMutation.mutateAsync(result.draft);
      toast.success({
        title: `${agentProviderMetadata(result.draft.provider).label} connected`,
        description: connection.host.name,
      });
      reset();
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The connection could not be saved.",
      );
    }
  }

  const providerMetadata = selectedProvider
    ? agentProviderMetadata(selectedProvider)
    : null;
  const dialogTitle = !providerMetadata
    ? "Add connection"
    : transport === "ssh"
      ? "Add SSH connection"
      : `Add ${providerMetadata.label} connection`;
  const dialogDescription = !providerMetadata
    ? "Choose a coding agent."
    : choosingSshHost
      ? "Choose a host from this server's SSH config."
      : `Connect OvertChat to an existing ${providerMetadata.label} installation.`;

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
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {dialogTitle}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {dialogDescription}
          </Dialog.Description>

          {!providerMetadata ? (
            <div className="mt-5 grid grid-cols-2 gap-2">
              <ProviderChoice
                icon={piIcon}
                label="Pi"
                onClick={() => selectProvider("pi")}
              />
              <ProviderChoice
                icon={ompIcon}
                label="Oh My Pi"
                darkIconSurface
                onClick={() => selectProvider("omp")}
              />
              <ProviderChoice
                icon={claudeCodeIcon}
                label="Claude Code"
                disabled
              />
              <ProviderChoice icon={codexIcon} label="Codex" disabled />
            </div>
          ) : (
            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void (isTested ? connect() : testConnection());
              }}
            >
              {!choosingSshHost && (
                <div className="space-y-1.5">
                  <Label htmlFor="agent-connection-name">Name</Label>
                  <Input
                    id="agent-connection-name"
                    value={name}
                    onChange={(event) => {
                      invalidateTest();
                      setName(event.target.value);
                    }}
                    autoFocus
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Location</Label>
                <RadioGroup
                  aria-label="Connection location"
                  value={transport}
                  onValueChange={(next) => {
                    const value = next as Transport;
                    invalidateTest();
                    setTransport(value);
                    setSelectedSshAlias(null);
                    if (value === "local") {
                      setName("This server");
                    } else {
                      setName(`Remote ${providerMetadata.label}`);
                      setRemoteMode("detected");
                      setHostname("");
                      setPort("22");
                      setUsername("");
                      setSshAuth(initialAuth);
                      setPrivateKey("");
                    }
                  }}
                  className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1"
                >
                  <TransportChoice
                    value="local"
                    label="This server"
                    icon={Server}
                  />
                  <TransportChoice
                    value="ssh"
                    label="Remote"
                    icon={Wifi}
                  />
                </RadioGroup>
              </div>

              {choosingSshHost && (
                <SshHostPicker
                  hosts={sshHosts.data ?? []}
                  selectedAlias={selectedSshAlias}
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
                  onAddManually={showManualConnection}
                />
              )}

              {transport === "ssh" && remoteMode === "manual" && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2"
                    disabled={pending}
                    onClick={showDetectedConnections}
                  >
                    <ChevronLeft />
                    SSH config
                  </Button>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
                    <div className="space-y-1.5">
                      <Label htmlFor="agent-hostname">Hostname</Label>
                      <Input
                        id="agent-hostname"
                        value={hostname}
                        onChange={(event) => {
                          invalidateTest();
                          setHostname(event.target.value);
                        }}
                        placeholder="workstation.local"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="agent-port">Port</Label>
                      <Input
                        id="agent-port"
                        type="number"
                        min={1}
                        max={65_535}
                        value={port}
                        onChange={(event) => {
                          invalidateTest();
                          setPort(event.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-username">Username</Label>
                    <Input
                      id="agent-username"
                      value={username}
                      onChange={(event) => {
                        invalidateTest();
                        setUsername(event.target.value);
                      }}
                      autoComplete="username"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Authentication</Label>
                    <RadioGroup
                      aria-label="SSH authentication"
                      value={sshAuth}
                      onValueChange={(next) => {
                        invalidateTest();
                        setSshAuth(next as SshAuth);
                      }}
                      className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1"
                    >
                      <TransportChoice
                        value="agent"
                        label="OpenSSH"
                        icon={Monitor}
                      />
                      <TransportChoice
                        value="private_key"
                        label="Private key"
                        icon={KeyRound}
                      />
                    </RadioGroup>
                    {sshAuth === "agent" && (
                      <p className="text-xs text-muted-foreground">
                        Uses this server&apos;s SSH config, default identities,
                        and SSH agent.
                      </p>
                    )}
                  </div>
                  {sshAuth === "private_key" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="agent-private-key">Private key</Label>
                      <Textarea
                        id="agent-private-key"
                        value={privateKey}
                        onChange={(event) => {
                          invalidateTest();
                          setPrivateKey(event.target.value);
                        }}
                        className="min-h-28 resize-y font-mono text-xs"
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <p className="text-xs text-muted-foreground">
                        Encrypted private keys are not supported yet.
                      </p>
                    </div>
                  )}
                </>
              )}

              {!choosingSshHost && (
                <div className="space-y-1.5">
                  <Label htmlFor="agent-executable">
                    {providerMetadata.label} executable
                  </Label>
                  <Input
                    id="agent-executable"
                    value={executable}
                    onChange={(event) => {
                      invalidateTest();
                      setExecutable(event.target.value);
                    }}
                    className="font-mono"
                    spellCheck={false}
                  />
                </div>
              )}

              {pendingHostKey?.hostKeyFingerprint && (
                <div className="border-y py-3">
                  <p className="text-sm font-medium">Verify SSH host</p>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {pendingHostKey.hostKeyFingerprint}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={pending}
                    onClick={() => void confirmFingerprint()}
                  >
                    {probeMutation.isPending ? (
                      <Loader2 className="animate-spin motion-reduce:animate-none" />
                    ) : (
                      <KeyRound />
                    )}
                    Trust host key
                  </Button>
                </div>
              )}

              {isTested && tested && (
                <div className="flex items-start gap-2 text-sm text-ring">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {providerMetadata.label} {tested.probe.version} ·{" "}
                    {tested.probe.models.length}{" "}
                    model{tested.probe.models.length === 1 ? "" : "s"}
                  </span>
                </div>
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
                {!choosingSshHost && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => void testConnection()}
                  >
                    {probeMutation.isPending && (
                      <Loader2 className="animate-spin motion-reduce:animate-none" />
                    )}
                    {isTested ? "Test again" : "Test connection"}
                  </Button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    pending ||
                    Boolean(pendingHostKey) ||
                    (choosingSshHost
                      ? !selectedSshAlias
                      : !isTested)
                  }
                >
                  {(createMutation.isPending ||
                    (choosingSshHost && probeMutation.isPending)) && (
                    <Loader2 className="animate-spin motion-reduce:animate-none" />
                  )}
                  {choosingSshHost && !isTested ? "Add" : "Connect"}
                </Button>
              </SettingsActions>
            </form>
          )}

          {!providerMetadata && (
            <SettingsActions bordered={false} className="mt-5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
            </SettingsActions>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProviderChoice({
  icon,
  label,
  darkIconSurface = false,
  disabled = false,
  onClick,
}: {
  icon: StaticImageData;
  label: string;
  darkIconSurface?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border bg-background px-3 py-4 text-sm font-medium outline-none motion-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-md",
          darkIconSurface && "bg-zinc-950",
        )}
      >
        <Image src={icon} alt="" className="size-6 object-contain" />
      </span>
      <span>{label}</span>
      {disabled && (
        <span className="text-[10px] font-normal text-muted-foreground">
          Coming soon
        </span>
      )}
    </button>
  );
}

function TransportChoice({
  value,
  label,
  icon: Icon,
  disabled = false,
}: {
  value: string;
  label: string;
  icon: typeof Server;
  disabled?: boolean;
}) {
  return (
    <Label
      className={cn(
        "relative flex h-8 cursor-pointer items-center justify-center rounded-md px-8 text-sm font-medium text-muted-foreground motion-colors outline-none has-data-[checked]:bg-background has-data-[checked]:text-foreground has-data-[checked]:shadow-xs has-focus-visible:ring-3 has-focus-visible:ring-ring/50 not-has-data-[checked]:hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <RadioGroupItem value={value} className="sr-only" disabled={disabled} />
      <span className="absolute left-3 flex size-4 items-center justify-center">
        <Icon className="size-3.5" />
      </span>
      <span className="truncate">{label}</span>
    </Label>
  );
}
