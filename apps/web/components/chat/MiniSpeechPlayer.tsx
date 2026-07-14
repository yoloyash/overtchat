"use client";

import { AlertTriangle, RotateCcw, X } from "lucide-react";
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
}: {
  speech: ReturnType<typeof useSpeech>;
}) {
  const { audioRef, activeId, status, canSeek, error, stop, retry } = speech;
  const active = activeId !== null;
  const loading = status === "loading";
  const visible = active || error !== null;

  return (
    <div hidden={!visible} className="mx-auto mt-2 w-full max-w-md px-4">
      <div hidden={!error}>
        <div
          role="alert"
          className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm shadow-sm"
        >
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 text-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            <RotateCcw /> Retry
          </Button>
          <button
            type="button"
            onClick={() => stop()}
            aria-label="Dismiss"
            className="rounded-md p-1.5 text-muted-foreground motion-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div
        hidden={!active || error !== null}
        className="flex items-center gap-1 rounded-2xl border bg-card px-2 py-1 shadow-sm"
      >
        <AudioPlayer className="flex-1">
          <audio ref={audioRef} slot="media" />
          <AudioPlayerControlBar>
            <AudioPlayerPlayButton disabled={loading} />
            {canSeek ? (
              <AudioPlayerTimeRange />
            ) : (
              <span
                aria-live="polite"
                className="flex-1 px-2 text-xs text-muted-foreground"
              >
                {loading ? "Loading…" : "Streaming…"}
              </span>
            )}
            <AudioPlayerTimeDisplay showDuration={canSeek} />
          </AudioPlayerControlBar>
        </AudioPlayer>
        <button
          type="button"
          onClick={() => stop()}
          aria-label="Close player"
          className="rounded-md p-2 text-muted-foreground motion-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
