"use client";

import { getApiOrigin } from "@/lib/api-url";
import { desktopBridge } from "@/lib/desktop";

/** In the desktop app, names the server being signed in to and offers another. */
export function DesktopServer() {
  const bridge = desktopBridge();
  const origin = getApiOrigin();
  if (!bridge || !origin) return null;
  return (
    <p className="mt-6 text-center text-sm text-muted-foreground">
      Connected to{" "}
      <span className="font-medium text-foreground">{new URL(origin).host}</span>
      {" · "}
      <button
        type="button"
        onClick={() => void bridge.changeServer()}
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        Change server
      </button>
    </p>
  );
}
