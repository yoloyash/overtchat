"use client";

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth/client";
import { useResetAuthState } from "@/lib/queries/auth";

export function SignupForm() {
  const navigate = useNavigate();
  const resetAuthState = useResetAuthState();
  const [code, setCode] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    return params.get("setup") ?? "";
  });
  useEffect(() => {
    if (new URLSearchParams(window.location.hash.slice(1)).has("setup")) {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const { data, error } = await authClient.$fetch<{ token: string | null }>(
      "/setup-admin",
      {
        method: "POST",
        body: { code, name: name.trim(), email, password },
      },
    );
    if (error) {
      setError(error.message ?? "Signup failed");
      setSubmitting(false);
      return;
    }
    resetAuthState();
    await navigate({ to: data?.token ? "/" : "/login", replace: true });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Create the first account
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This becomes the admin account. Signup closes after this.
        </p>
      </header>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="setup-code">Setup code</Label>
          <Input
            id="setup-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            Use the code from your installer, run overtchat status on the server, or
            check the app container&apos;s logs.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Creating…" : "Create account"}
      </Button>
    </form>
  );
}
