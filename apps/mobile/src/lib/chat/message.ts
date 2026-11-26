import { speechErrorMessage } from "@overtchat/shared";
import { i18n } from "@overtchat/shared/i18n";
import type { DictationError } from "@/lib/useDictation";

export function dictationErrorMessage(
  err: DictationError,
  isAdmin: boolean,
): string {
  switch (err.kind) {
    case "permission":
      return i18n.t("chat.mobile.dictation.permission");
    case "unsupported":
      return i18n.t("chat.mobile.dictation.unsupported");
    case "stt_unavailable":
      if (!isAdmin && err.code === "speech_disabled") {
        return i18n.t("chat.dictation.errors.disabledNonAdmin");
      }
      if (!isAdmin && err.code === "speech_not_configured") {
        return i18n.t("chat.dictation.errors.notConfiguredNonAdmin");
      }
      return speechErrorMessage("stt", err.code);
    case "empty":
      return i18n.t("chat.dictation.errors.empty");
    case "other":
      return err.message;
  }
}
