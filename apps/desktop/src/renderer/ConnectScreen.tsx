import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { shell } from "./shell";

export function ConnectScreen({ lastAddress }: { lastAddress: string }) {
  const [address, setAddress] = useState(lastAddress);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!address.trim()) {
      setError("Enter your server's address.");
      return;
    }
    setConnecting(true);
    setError("");
    const result = await shell.connect(address);
    if (!result.ok) {
      setError(result.message);
      setConnecting(false);
      return;
    }
    window.location.reload();
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
    </form>
  );
}
