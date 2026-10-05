import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hostOf, shell } from "./shell";
import type { LocalServer } from "../shared/ipc";
import { DesktopUpdateAction } from "@/components/DesktopUpdateAction";

export function ConnectScreen({ lastAddress }: { lastAddress: string }) {
  const [address, setAddress] = useState(lastAddress);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [localServers, setLocalServers] = useState<LocalServer[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setDiscovering(true);
    void shell.discoverLocalServers().catch(() => []).then((servers) => {
      if (!active) return;
      setLocalServers(servers);
      setDiscovering(false);
    });
    return () => { active = false; };
  }, [discoveryAttempt]);

  async function connect(target: string) {
    setConnecting(true);
    setError("");
    try {
      const result = await shell.connect(target);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't connect to the server. Try again.");
    } finally {
      setConnecting(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!address.trim()) {
      setError("Enter your server's address.");
      return;
    }
    await connect(address);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Connect to your server
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the address you open OvertChat at in your browser.
        </p>
      </header>

      <section aria-label="Servers on this computer" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">On this computer</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={discovering || connecting}
            onClick={() => {
              setError("");
              setDiscoveryAttempt((attempt) => attempt + 1);
            }}
          >
            Check again
          </Button>
        </div>
        <div role="status" className="text-sm text-muted-foreground">
          {discovering
            ? "Looking for OvertChat…"
            : localServers.length === 0
              ? "No local server found. You can enter an address below."
              : "OvertChat found on this computer."}
        </div>
        <ul className="space-y-2">
          {localServers.map((server) => (
            <li key={server.origin} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{hostOf(server.origin)}</p>
                {server.version && <p className="text-muted-foreground">OvertChat {server.version}</p>}
                {server.problem?.kind === "server-outdated" && <p className="text-muted-foreground">Server update required</p>}
                {server.problem?.kind === "app-outdated" && <p className="text-muted-foreground">Desktop update required</p>}
              </div>
              <Button type="button" size="sm" disabled={connecting} onClick={() => {
                setAddress(server.origin);
                void connect(server.origin);
              }}>
                Connect
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-1.5">
        <Label htmlFor="address">Server address</Label>
        <Input
          id="address"
          type="text"
          inputMode="url"
          placeholder="chat.example.com"
          autoComplete="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          value={address}
          disabled={connecting}
          aria-invalid={!!error}
          onChange={(event) => {
            setAddress(event.target.value);
            setError("");
          }}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={connecting} className="w-full">
        {connecting ? "Connecting…" : "Continue"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have a server yet?{" "}
        <a
          href="https://overtchat.com"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Set one up
        </a>
      </p>
      <div className="text-center">
        <DesktopUpdateAction alwaysVisible />
      </div>
    </form>
  );
}
