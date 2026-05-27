import { type AudioPlayer, createAudioPlayer } from "expo-audio";
import { File as FsFile, Paths } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch, getApiBase } from "@/lib/api";

export type SpeechStatus = "idle" | "loading" | "playing" | "paused";

export function useSpeech() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const playerRef = useRef<AudioPlayer | null>(null);
  const fileRef = useRef<FsFile | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const subRef = useRef<{ remove: () => void } | null>(null);
  const lastPlayedRef = useRef<{ id: string; text: string } | null>(null);

  const teardown = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    subRef.current?.remove();
    subRef.current = null;
    if (playerRef.current) {
      try {
        playerRef.current.pause();
      } catch {
        // ignore
      }
      try {
        playerRef.current.remove();
      } catch {
        // ignore
      }
      playerRef.current = null;
    }
    if (fileRef.current) {
      try {
        fileRef.current.delete();
      } catch {
        // best-effort cleanup
      }
      fileRef.current = null;
    }
    setActiveId(null);
    setStatus("idle");
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const stop = useCallback(() => {
    teardown();
    setError(null);
    lastPlayedRef.current = null;
  }, [teardown]);

  useEffect(() => stop, [stop]);

  const play = useCallback(
    async (id: string, text: string) => {
      if (activeId === id) {
        stop();
        return;
      }
      stop();
      const trimmed = text.trim();
      if (!trimmed) return;

      lastPlayedRef.current = { id, text };

      const ac = new AbortController();
      abortRef.current = ac;
      setActiveId(id);
      setStatus("loading");

      const fail = (msg: string) => {
        teardown();
        setError(msg);
      };

      try {
        const res = await authFetch(`${getApiBase()}/api/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`TTS failed (${res.status})`);
        const buf = await res.arrayBuffer();
        if (ac.signal.aborted) return;

        const file = new FsFile(
          Paths.cache,
          `tts-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}.mp3`,
        );
        try {
          file.create();
        } catch {
          // file may already exist after a prior leak; overwrite via write below
        }
        file.write(new Uint8Array(buf));
        if (ac.signal.aborted) {
          try {
            file.delete();
          } catch {
            // ignore
          }
          return;
        }
        fileRef.current = file;

        const player = createAudioPlayer(file.uri);
        playerRef.current = player;
        subRef.current = player.addListener("playbackStatusUpdate", (s) => {
          if (s.didJustFinish) {
            stop();
            return;
          }
          if (typeof s.currentTime === "number") setCurrentTime(s.currentTime);
          if (typeof s.duration === "number" && s.duration > 0) {
            setDuration(s.duration);
          }
          if (s.playing) setStatus("playing");
          else if (s.isLoaded) {
            setStatus((prev) =>
              prev === "loading" || prev === "playing" ? "paused" : prev,
            );
          }
        });
        player.play();
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        fail(networkErrorMessage(err));
      }
    },
    [activeId, stop, teardown],
  );

  const pause = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.pause();
      setStatus("paused");
    } catch {
      stop();
    }
  }, [stop]);

  const resume = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.play();
      setStatus("playing");
    } catch {
      stop();
    }
  }, [stop]);

  const seek = useCallback((seconds: number) => {
    const p = playerRef.current;
    if (!p) return;
    try {
      void p.seekTo(seconds);
      setCurrentTime(seconds);
    } catch {
      // ignore — next status update will reconcile
    }
  }, []);

  const retry = useCallback(() => {
    const last = lastPlayedRef.current;
    if (!last) return;
    void play(last.id, last.text);
  }, [play]);

  return {
    activeId,
    status,
    currentTime,
    duration,
    error,
    play,
    pause,
    resume,
    seek,
    stop,
    retry,
  };
}

function networkErrorMessage(err: unknown): string {
  const msg = (err as Error)?.message ?? "";
  if (msg.includes("TTS failed")) return "Speech service unavailable.";
  if (msg.toLowerCase().includes("network")) return "Network error.";
  return "Couldn't play speech.";
}
