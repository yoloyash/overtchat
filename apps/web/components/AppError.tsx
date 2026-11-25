"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { Button } from "@/components/ui/button";
import { getApiOrigin } from "@/lib/api-url";
import { desktopBridge } from "@/lib/desktop";

/** Recovery must remain available even when route guards never render the UI. */
export function AppError({ error }: { error: unknown }) {
  const { t } = useTranslation();
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
      setChangeError(t("app.error.changeServerError"));
    } finally {
      setChanging(false);
    }
  }

  return (
    <AuthFrame>
      <section className="space-y-5" aria-labelledby="app-error-title">
        <header>
          <h1 id="app-error-title" className="text-xl font-semibold tracking-tight">{t("app.error.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("app.error.description")}
          </p>
          {bridge && origin && <p className="mt-2 break-all text-sm text-muted-foreground">{t("app.error.server", { origin })}</p>}
        </header>
        <div className="flex flex-col gap-2">
          {/* A full reload also reruns the desktop's compatibility/connection check. */}
          <Button onClick={() => window.location.reload()}>{t("app.error.tryAgain")}</Button>
          {bridge && (
            <Button variant="outline" disabled={changing} onClick={() => void changeServer()}>
              {changing ? t("app.error.changingServer") : t("app.error.changeServer")}
            </Button>
          )}
        </div>
        {changeError && <p role="alert" className="text-sm text-destructive">{changeError}</p>}
        {error instanceof Error && (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">{t("app.error.details")}</summary>
            <p className="mt-2 break-words whitespace-pre-wrap">{error.message}</p>
          </details>
        )}
      </section>
    </AuthFrame>
  );
}
