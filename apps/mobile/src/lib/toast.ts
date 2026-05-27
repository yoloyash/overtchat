import * as Burnt from "burnt";

export function toastSuccess(title: string, message?: string) {
  Burnt.toast({ title, message, preset: "done", haptic: "success" });
}

export function toastError(title: string, error?: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : undefined;
  Burnt.toast({ title, message, preset: "error", haptic: "error" });
}
