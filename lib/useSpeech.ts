"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechStatus = "idle" | "loading" | "playing";

export function useSpeech() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setActiveId(null);
    setStatus("idle");
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback(
    async (id: string, text: string) => {
      if (activeId === id) {
        stop();
        return;
      }
      stop();
      if (!text.trim()) return;

      const ac = new AbortController();
      abortRef.current = ac;
      setActiveId(id);
      setStatus("loading");

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`TTS failed (${res.status})`);
        const blob = await res.blob();
        if (ac.signal.aborted) return;

        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => stop();
        audio.onerror = () => stop();
        setStatus("playing");
        await audio.play();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("TTS error:", err);
        }
        stop();
      }
    },
    [activeId, stop],
  );

  return { activeId, status, play, stop };
}
