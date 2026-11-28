import type { TFunction } from "i18next";
import { speechErrorMessage } from "@overtchat/shared";
import type { DictationError } from "@/lib/useDictation";

export function dictationErrorMessage(
  err: DictationError,
  isAdmin: boolean,
  t: TFunction,
): string {
  switch (err.kind) {
    case "permission":
      return t("chat.mobile.dictation.permission");
    case "unsupported":
      return t("chat.mobile.dictation.unsupported");
    case "stt_unavailable":
      if (!isAdmin && err.code === "speech_disabled") {
        return t("chat.dictation.errors.disabledNonAdmin");
      }
      if (!isAdmin && err.code === "speech_not_configured") {
        return t("chat.dictation.errors.notConfiguredNonAdmin");
      }
      return speechErrorMessage("stt", t, err.code);
    case "empty":
      return t("chat.dictation.errors.empty");
    case "other":
      return err.message;
  }
}
