"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dictationErrorMessage } from "@/lib/chat/message";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Dictation, DictationError } from "@/lib/useDictation";

/**
 * Microphone control shared by the chat and agent composers. Each composer owns
 * its `useDictation` handle so it can also start capture from its slash-command
 * palette, and passes that handle down here.
 */
export function DictateButton({
  dictation,
  disabled = false,
  onBeforeStart,
}: {
  dictation: Dictation;
  /** Chat-level reasons capture cannot run (e.g. a live realtime voice call). */
  disabled?: boolean;
  /**
   * Runs immediately before capture starts. Composers that can be reading an
   * answer aloud use this to stop playback, so the server never transcribes
   * its own speech.
   */
  onBeforeStart?: () => void;
}) {
  const recording = dictation.status === "recording";
  const transcribing = dictation.status === "transcribing";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "rounded-full",
        recording &&
          "bg-destructive text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground",
      )}
      onClick={() => {
        if (recording) {
          dictation.stop();
        } else if (dictation.status === "idle") {
          onBeforeStart?.();
          void dictation.start();
        }
      }}
      disabled={transcribing || disabled}
      aria-label={
        recording
          ? "Stop dictation"
          : transcribing
            ? "Transcribing"
            : "Dictate"
      }
      aria-pressed={recording}
    >
      {transcribing ? (
        <Loader2 className={motionClasses.spinner} />
      ) : recording ? (
        <Square className="size-3 fill-current" />
      ) : (
        <Mic />
      )}
    </Button>
  );
}

/** Transcription failures are actionable prose; composers render it above the field. */
export function DictateError({
  error,
  isAdmin,
}: {
  error: DictationError | null;
  isAdmin: boolean;
}) {
  if (!error) return null;
  return (
    <p className="mb-2 text-sm text-destructive">
      {dictationErrorMessage(error, isAdmin)}
    </p>
  );
}
