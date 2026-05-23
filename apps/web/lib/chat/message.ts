import { remark } from "remark";
import strip from "strip-markdown";
import type { UIMessage } from "ai";
import type { DictationError } from "@/lib/useDictation";
import { stripCitationMarkers } from "@/lib/citations";

const stripper = remark().use(strip);

export function stripMarkdown(s: string): string {
  return String(stripper.processSync(s)).replace(/\s+/g, " ").trim();
}

export function textOf(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function speakableText(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => stripMarkdown(stripCitationMarkers((p as { text: string }).text)))
    .join(" ")
    .trim();
}

export function dictationErrorMessage(
  err: DictationError,
  isAdmin: boolean,
): string {
  switch (err.kind) {
    case "permission":
      return "Microphone access denied. Allow it in your browser settings to dictate.";
    case "unsupported":
      return "Your browser doesn't support audio recording.";
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

export function chatErrorMessage(error: Error): string {
  const msg = error.message ?? "";
  if (
    error.name === "TypeError" ||
    /failed to fetch|networkerror|network request failed|load failed/i.test(msg)
  ) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return msg || "Something went wrong. Please try again.";
}
