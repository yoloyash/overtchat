import { i18n } from "@overtchat/shared/i18n";

/** The bundled UI must match the selected server, including after restart. */
export function updateCompatibilityMessage(candidate: unknown, serverApiLevel: number): string | null {
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 1) {
    throw new Error("The desktop update is missing valid compatibility information. Try again later.");
  }
  if (candidate > serverApiLevel) {
    return i18n.t("app.desktopNative.updates.needsNewerServer");
  }
  if (candidate < serverApiLevel) {
    return i18n.t("app.desktopNative.updates.serverNotSupportedYet");
  }
  return null;
}
