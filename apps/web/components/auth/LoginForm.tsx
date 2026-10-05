"use client";

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth/client";
import { useResetAuthState } from "@/lib/queries/auth";

export function LoginForm() {
  const navigate = useNavigate();
  const resetAuthState = useResetAuthState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      setError(error.message ?? "Login failed");
      setSubmitting(false);
      return;
    }
    resetAuthState();
    await navigate({ to: "/", replace: true });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to continue.
        </p>
      </header>

      <div className="space-y-4">
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
      <Button
        type="button"
        variant="link"
        className="w-full"
        aria-expanded={showRecovery}
        aria-controls="password-recovery-help"
        onClick={() => setShowRecovery((shown) => !shown)}
      >
        Forgot password?
      </Button>
      {showRecovery && (
        <div id="password-recovery-help" className="space-y-2 text-sm text-muted-foreground">
          <p>
            Contact your server administrator to reset your password. Another
            administrator can also help if you are an admin.
          </p>
          <p>
            If all administrators are locked out, the server owner can run{" "}
            <code>overtchat reset-password</code> on the server.
          </p>
        </div>
      )}
    </form>
  );
}
