"use client";

import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  Bot,
  CheckCircle2,
  Code2,
  KeyRound,
  Loader2,
  Monitor,
  Server,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type {
  AgentConnectionDraft,
  AgentHostKeyProbe,
  AgentReadyConnectionProbe,
} from "@/lib/agents/types";
import {
  useCreateAgentConnection,
  useProbeAgentConnection,
} from "@/lib/queries/agentConnections";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  SettingsActions,
  SettingsNotice,
} from "../_components/SettingsRows";

type Transport = "local" | "ssh";
type SshAuth = "agent" | "private_key";

type TestedConnection = {
  signature: string;
  probe: AgentReadyConnectionProbe;
};

export function AddConnectionDialog({
  open,
  onOpenChange,
  isAdmin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
}) {
  const initialTransport: Transport = isAdmin ? "local" : "ssh";
  const initialAuth: SshAuth = isAdmin ? "agent" : "private_key";
  const probeMutation = useProbeAgentConnection();
  const createMutation = useCreateAgentConnection();
  const [providerSelected, setProviderSelected] = useState(false);
  const [transport, setTransport] = useState<Transport>(initialTransport);
  const [name, setName] = useState(
    initialTransport === "local" ? "This server" : "Remote Pi",
  );
  const [executable, setExecutable] = useState("pi");
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

  function reset() {
    setProviderSelected(false);
    setTransport(initialTransport);
    setName(initialTransport === "local" ? "This server" : "Remote Pi");
    setExecutable("pi");
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

  function buildDraft(hostKey = confirmedHostKey):
    | { draft: AgentConnectionDraft }
    | { error: string } {
    const trimmedName = name.trim();
    const trimmedExecutable = executable.trim();
    if (!trimmedName) return { error: "Enter a connection name." };
    if (!trimmedExecutable) return { error: "Enter the Pi executable path." };
    if (transport === "local") {
      return {
        draft: {
          provider: "pi",
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
        provider: "pi",
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
    sshAuth,
    transport,
  ]);
  const isTested =
    currentSignature !== null && tested?.signature === currentSignature;
  const pending = probeMutation.isPending || createMutation.isPending;

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
        title: "Pi connected",
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
            Add connection
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {providerSelected
              ? "Connect OvertChat to an existing Pi installation."
              : "Choose a coding agent."}
          </Dialog.Description>

          {!providerSelected ? (
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              <ProviderChoice
                icon={TerminalSquare}
                label="Pi"
                onClick={() => setProviderSelected(true)}
              />
              <ProviderChoice icon={Bot} label="Claude Code" disabled />
              <ProviderChoice icon={Code2} label="Codex" disabled />
            </div>
          ) : (
            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void (isTested ? connect() : testConnection());
              }}
            >
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

              <div className="space-y-1.5">
                <Label>Location</Label>
                <RadioGroup
                  aria-label="Connection location"
                  value={transport}
                  onValueChange={(next) => {
                    const value = next as Transport;
                    invalidateTest();
                    setTransport(value);
                    if (name === "This server" || name === "Remote Pi") {
                      setName(value === "local" ? "This server" : "Remote Pi");
                    }
                  }}
                  className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1"
                >
                  <TransportChoice
                    value="local"
                    label="This server"
                    icon={Server}
                    disabled={!isAdmin}
                  />
                  <TransportChoice
                    value="ssh"
                    label="Remote"
                    icon={Wifi}
                  />
                </RadioGroup>
                {!isAdmin && (
                  <p className="text-xs text-muted-foreground">
                    Local agent execution is available to administrators.
                  </p>
                )}
              </div>

              {transport === "ssh" && (
                <>
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
                        label="SSH agent"
                        icon={Monitor}
                        disabled={!isAdmin}
                      />
                      <TransportChoice
                        value="private_key"
                        label="Private key"
                        icon={KeyRound}
                      />
                    </RadioGroup>
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

              <div className="space-y-1.5">
                <Label htmlFor="agent-executable">Pi executable</Label>
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
                    Pi {tested.probe.version} · {tested.probe.models.length}{" "}
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
                <Button type="submit" size="sm" disabled={!isTested || pending}>
                  {createMutation.isPending && (
                    <Loader2 className="animate-spin motion-reduce:animate-none" />
                  )}
                  Connect
                </Button>
              </SettingsActions>
            </form>
          )}

          {!providerSelected && (
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
  icon: Icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: typeof TerminalSquare;
  label: string;
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
      <Icon className="size-5" />
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
        "flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground motion-colors outline-none has-data-[checked]:bg-background has-data-[checked]:text-foreground has-data-[checked]:shadow-xs has-focus-visible:ring-3 has-focus-visible:ring-ring/50 not-has-data-[checked]:hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <RadioGroupItem value={value} className="sr-only" disabled={disabled} />
      <Icon className="size-3.5" />
      <span>{label}</span>
    </Label>
  );
}
