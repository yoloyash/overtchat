import { getErrorMessage } from "@overtchat/shared";
import * as Burnt from "burnt";

export function toastSuccess(title: string, message?: string) {
  Burnt.toast({ title, message, preset: "done", haptic: "success" });
}

export function toastError(title: string, error?: unknown) {
  const message = error == null ? undefined : getErrorMessage(error);
  Burnt.toast({ title: getErrorMessage(title), message, preset: "error", haptic: "error" });
}
