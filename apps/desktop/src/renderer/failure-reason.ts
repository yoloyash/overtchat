import type { TFunction } from "i18next";
import type { ConnectFailureReason } from "../shared/ipc";

/** A connection failure in the person's language; the English message when it has no code. */
export function failureText(
  failure: { message: string; reason?: ConnectFailureReason },
  t: TFunction,
): string {
  const reason = failure.reason;
  if (!reason) return failure.message;
  const { host, version } = reason;
  switch (reason.code) {
    case "address-required":
      return t("app.desktopShell.reasons.addressRequired");
    case "untrusted-certificate":
      return t("app.desktopShell.reasons.untrustedCertificate", { host });
    case "timeout":
      return t("app.desktopShell.reasons.timeout", { host });
    case "no-answer":
      return t("app.desktopShell.reasons.noAnswer", { host });
    case "not-overtchat":
      return t("app.desktopShell.reasons.notOvertchat", { host });
    case "redirected":
      return t("app.desktopShell.reasons.redirected", { host });
    case "server-outdated":
      return version
        ? t("app.desktopShell.reasons.serverOutdatedVersion", { host, version })
        : t("app.desktopShell.reasons.serverOutdatedUnknown", { host });
    case "app-outdated":
      return version
        ? t("app.desktopShell.reasons.appOutdatedVersion", { host, version })
        : t("app.desktopShell.reasons.appOutdatedUnknown", { host });
    default:
      return failure.message;
  }
}
