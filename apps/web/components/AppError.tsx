"use client";

import { useState } from "react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { Button } from "@/components/ui/button";
import { getApiOrigin } from "@/lib/api-url";
import { desktopBridge } from "@/lib/desktop";

/** Recovery must remain available even when route guards never render the UI. */
export function AppError({ error }: { error: unknown }) {
  const bridge = desktopBridge();
  const origin = getApiOrigin();
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState("");

  async function changeServer() {
    setChanging(true);
    setChangeError("");
    try {
      await bridge?.changeServer();
    } catch {
      setChangeError("Couldn't change servers. Try again or restart the app.");
    } finally {
      setChanging(false);
    }
  }

  return (
    <AuthFrame>
      <section className="space-y-5" aria-labelledby="app-error-title">
        <header>
          <h1 id="app-error-title" className="text-xl font-semibold tracking-tight">Couldn&apos;t load OvertChat</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your connection and that the server is running, then try again.
          </p>
          {bridge && origin && <p className="mt-2 break-all text-sm text-muted-foreground">Server: {origin}</p>}
        </header>
        <div className="flex flex-col gap-2">
          {/* A full reload also reruns the desktop's compatibility/connection check. */}
          <Button onClick={() => window.location.reload()}>Try again</Button>
          {bridge && (
            <Button variant="outline" disabled={changing} onClick={() => void changeServer()}>
              {changing ? "Changing server…" : "Change server"}
            </Button>
          )}
        </div>
        {changeError && <p role="alert" className="text-sm text-destructive">{changeError}</p>}
        {error instanceof Error && (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Error details</summary>
            <p className="mt-2 break-words whitespace-pre-wrap">{error.message}</p>
          </details>
        )}
      </section>
    </AuthFrame>
  );
}
