"use client";

import { Link } from "@tanstack/react-router";
import { RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorNotice } from "@/components/ui/error-notice";
import { Button } from "@/components/ui/button";
import type { useSpeech } from "@/lib/useSpeech";
import {
  AudioPlayer,
  AudioPlayerControlBar,
  AudioPlayerPlayButton,
  AudioPlayerTimeDisplay,
  AudioPlayerTimeRange,
} from "./audio-player";

// <media-time-range> mounts only when canSeek: a time-range bound to an
// infinite-duration MSE source stays broken even after endOfStream() makes
// duration finite. The <audio> stays mounted across all UI states so
// useSpeech.play() can set src synchronously inside the gesture handler
// (mobile autoplay requires play() in the same tick as the tap).
export function MiniSpeechPlayer({
  speech,
  isAdmin = false,
}: {
  speech: ReturnType<typeof useSpeech>;
  isAdmin?: boolean;
}) {
  const { t } = useTranslation();
  const { audioRef, activeId, status, canSeek, error, canRetry, stop, retry } =
    speech;
  const active = activeId !== null;
  const loading = status === "loading";
  const visible = active || error !== null;

  return (
    <div hidden={!visible} className="mx-auto mt-2 w-full max-w-md px-4">
      {error && (
        <ErrorNotice
          message={error}
          onDismiss={stop}
          actions={
            <>
              {canRetry && (
                <Button variant="outline" size="sm" onClick={retry}>
                  <RotateCcw /> {t("chat.speech.retryPlayback")}
                </Button>
              )}
              {isAdmin && (
                <Link
                  to="/settings/services"
                  className="text-xs underline underline-offset-4"
                >
                  {t("chat.speech.settings")}
                </Link>
              )}
            </>
          }
        />
      )}

      <div
        hidden={!active || error !== null}
        className="flex items-center gap-1 rounded-2xl border bg-card px-2 py-1 shadow-sm"
      >
        <AudioPlayer className="flex-1">
          <audio ref={audioRef} slot="media" tabIndex={-1} />
          <AudioPlayerControlBar>
            <AudioPlayerPlayButton disabled={loading} />
            {canSeek ? (
              <AudioPlayerTimeRange />
            ) : (
              <span
                aria-live="polite"
                className="flex-1 px-2 text-xs text-muted-foreground"
              >
                {loading ? t("common.states.loading") : t("chat.speech.streaming")}
              </span>
            )}
            <AudioPlayerTimeDisplay showDuration={canSeek} />
          </AudioPlayerControlBar>
        </AudioPlayer>
        <button
          type="button"
          onClick={() => stop()}
          aria-label={t("chat.speech.closePlayer")}
          className="rounded-md p-2 text-muted-foreground motion-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
