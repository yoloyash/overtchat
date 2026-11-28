"use client";

import { Trans, useTranslation } from "react-i18next";
import { getApiOrigin } from "@/lib/api-url";
import { desktopBridge } from "@/lib/desktop";

/** In the desktop app, names the server being signed in to and offers another. */
export function DesktopServer() {
  const { t } = useTranslation();
  const bridge = desktopBridge();
  const origin = getApiOrigin();
  if (!bridge || !origin) return null;
  return (
    <p className="mt-6 text-center text-sm text-muted-foreground">
      <Trans
        i18nKey="auth.desktopServer.connectedTo"
        values={{ host: new URL(origin).host }}
        components={{
          host: <span className="font-medium text-foreground" />,
        }}
      />
      {" · "}
      <button
        type="button"
        onClick={() => void bridge.changeServer()}
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        {t("auth.desktopServer.changeServer")}
      </button>
    </p>
  );
}
