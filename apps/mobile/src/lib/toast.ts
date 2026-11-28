import { getErrorMessage } from "@overtchat/shared";
import { i18n } from "@overtchat/shared/i18n";
import * as Burnt from "burnt";

export function toastSuccess(title: string, message?: string) {
  Burnt.toast({ title, message, preset: "done", haptic: "success" });
}

/** `error` is an error to describe, or a message to show as written. */
export function toastError(title: string, error?: unknown) {
  const message =
    error == null
      ? undefined
      : typeof error === "string"
        ? error
        : getErrorMessage(error, i18n.t("common.errors.generic"));
  Burnt.toast({ title, message, preset: "error", haptic: "error" });
}
