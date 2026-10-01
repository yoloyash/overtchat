"use client";

import { Link } from "@tanstack/react-router";
import { ErrorNotice } from "@/components/ui/error-notice";
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
  /** Prevents starting capture; an active recording can always be stopped. */
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
      disabled={transcribing || (disabled && !recording)}
      aria-label={
        recording ? "Stop dictation" : transcribing ? "Transcribing" : "Dictate"
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
  onDismiss,
  onRecordAgain,
}: {
  error: DictationError | null;
  isAdmin: boolean;
  onDismiss: () => void;
  onRecordAgain: () => void;
}) {
  if (!error) return null;
  const setupRequired =
    error.kind === "stt_unavailable" &&
    (error.code === "speech_disabled" ||
      error.code === "speech_not_configured" ||
      error.code === "speech_provider_auth");
  const canRecordAgain =
    error.kind === "empty" ||
    error.kind === "other" ||
    (error.kind === "stt_unavailable" && !setupRequired);
  return (
    <ErrorNotice
      className="mb-2"
      message={dictationErrorMessage(error, isAdmin)}
      onDismiss={onDismiss}
      actions={
        <>
          {canRecordAgain && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRecordAgain}
            >
              Record again
            </Button>
          )}
          {isAdmin && error.kind === "stt_unavailable" && (
            <Link
              to="/settings/services"
              className="text-xs underline underline-offset-4"
            >
              Speech settings
            </Link>
          )}
        </>
      }
    />
  );
}
