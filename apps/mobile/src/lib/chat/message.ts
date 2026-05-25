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
      return isAdmin || err.role === "admin"
        ? "Speech-to-text isn't running. Start it with: docker compose --profile stt up -d (or --profile stt-gpu for NVIDIA GPU)."
        : "Speech-to-text isn't enabled. Ask the admin to enable it.";
    case "empty":
      return "No speech detected. Try again.";
    case "other":
      return err.message || "Transcription failed.";
  }
}
