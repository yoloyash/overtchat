import { speechErrorMessage } from "@overtchat/shared";
import type { DictationError } from "@/lib/useDictation";

export function dictationErrorMessage(
  err: DictationError,
  isAdmin: boolean,
): string {
  switch (err.kind) {
    case "permission":
      return "Microphone access denied. Allow it in your device settings to dictate.";
    case "unsupported":
      return "Audio recording isn't supported on this device.";
    case "stt_unavailable":
      return speechErrorMessage("stt", err.code) +
        (!isAdmin && (err.code === "speech_disabled" || err.code === "speech_not_configured")
          ? " Ask an administrator to enable it." : "");
    case "empty":
      return "No speech detected. Try again.";
    case "other":
      return err.message;
  }
}
