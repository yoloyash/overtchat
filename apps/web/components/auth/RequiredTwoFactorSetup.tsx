"use client";

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { useResetAuthState } from "@/lib/queries/auth";
import { TwoFactorSetup } from "./TwoFactorSetup";

/** Shown to administrators before the app when the server requires two-factor. */
export function RequiredTwoFactorSetup({ email }: { email: string }) {
  const navigate = useNavigate();
  const resetAuthState = useResetAuthState();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    const { error } = await authClient.signOut();
    if (error) {
      setSigningOut(false);
      return;
    }
    resetAuthState();
    await navigate({ to: "/login", replace: true });
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Set up two-factor authentication
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This server requires administrators to sign in with a code from an
          authenticator app, as well as their password.
        </p>
      </header>
      <TwoFactorSetup
        email={email}
        onDone={() => navigate({ to: "/", replace: true })}
      />
      <Button
        type="button"
        variant="link"
        className="w-full"
        disabled={signingOut}
        onClick={signOut}
      >
        Sign out
      </Button>
    </div>
  );
}
