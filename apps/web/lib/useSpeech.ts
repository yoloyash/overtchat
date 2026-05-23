"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechStatus = "idle" | "loading" | "playing";

const MIME = "audio/mpeg";

type MSCtor = typeof MediaSource & { isTypeSupported(t: string): boolean };

// iOS 17.1+ exposes ManagedMediaSource instead of MediaSource. Prefer it where
// available — it's the one Safari actually supports for streaming audio.
function getMediaSourceCtor(): MSCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    ManagedMediaSource?: MSCtor;
    MediaSource?: MSCtor;
  };
  const C = w.ManagedMediaSource ?? w.MediaSource;
  if (!C || typeof C.isTypeSupported !== "function") return null;
  return C.isTypeSupported(MIME) ? C : null;
}

export function useSpeech() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const ms = mediaSourceRef.current;
    if (ms && ms.readyState === "open") {
      try {
        ms.endOfStream();
      } catch {
        // ignore — MediaSource may already be closing
      }
    }
    mediaSourceRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
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

  // Must be called synchronously from a user-gesture handler. Mobile browsers
  // (iOS Safari, Android Chrome) require Audio.play() to fire in the same tick
  // as the tap — awaiting a fetch before creating the audio element lets the
  // gesture expire and play() is rejected silently. We wire up Audio +
  // MediaSource and call play() before any await; bytes stream in afterwards.
  const play = useCallback(
    (id: string, text: string) => {
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

      const MSCtor = getMediaSourceCtor();
      if (!MSCtor) {
        // No MSE available (iOS < 17.1). Blob path can't start audio inside
        // the gesture since we need bytes first — playback will likely be
        // blocked by mobile autoplay policy. Unavoidable without MSE.
        void playBlobFallback(text, ac, {
          setAudio: (a) => (audioRef.current = a),
          setUrl: (u) => (urlRef.current = u),
          onPlaying: () => setStatus("playing"),
          onEnd: () => stop(),
        });
        return;
      }

      const mediaSource = new MSCtor();
      mediaSourceRef.current = mediaSource;
      const url = URL.createObjectURL(mediaSource);
      urlRef.current = url;

      const audio = new Audio();
      audioRef.current = audio;
      audio.src = url;
      audio.onended = () => stop();
      audio.onerror = () => stop();

      // play() returns a promise that resolves once buffered data actually
      // starts playing. We don't await — the async byte pump below has to
      // keep running after this synchronous handler returns.
      audio.play().then(
        () => setStatus("playing"),
        () => stop(),
      );

      void streamIntoMediaSource(mediaSource, text, ac, {
        onEnd: () => stop(),
      });
    },
    [activeId, stop],
  );

  return { activeId, status, play, stop };
}

async function streamIntoMediaSource(
  mediaSource: MediaSource,
  text: string,
  ac: AbortController,
  h: { onEnd: () => void },
): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      if (mediaSource.readyState === "open") return resolve();
      mediaSource.addEventListener("sourceopen", () => resolve(), {
        once: true,
      });
      mediaSource.addEventListener(
        "error",
        () => reject(new Error("MediaSource error")),
        { once: true },
      );
      ac.signal.addEventListener(
        "abort",
        () => reject(new Error("AbortError")),
        { once: true },
      );
    });
    if (ac.signal.aborted) return;

    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) throw new Error(`TTS failed (${res.status})`);

    const sb = mediaSource.addSourceBuffer(MIME);
    const queue: BufferSource[] = [];
    let closing = false;

    const pump = () => {
      if (sb.updating || queue.length === 0) return;
      const chunk = queue.shift()!;
      try {
        sb.appendBuffer(chunk);
      } catch {
        h.onEnd();
      }
    };
    sb.addEventListener("updateend", () => {
      if (queue.length > 0) pump();
      else if (closing && mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch {
          // already closed
        }
      }
    });

    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (ac.signal.aborted) return;
      if (done) {
        closing = true;
        if (!sb.updating && mediaSource.readyState === "open") {
          try {
            mediaSource.endOfStream();
          } catch {
            // ignore
          }
        }
        return;
      }
      if (value) {
        queue.push(value as BufferSource);
        pump();
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.error("TTS stream error:", err);
      h.onEnd();
    }
  }
}

async function playBlobFallback(
  text: string,
  ac: AbortController,
  h: {
    setAudio: (a: HTMLAudioElement) => void;
    setUrl: (u: string) => void;
    onPlaying: () => void;
    onEnd: () => void;
  },
): Promise<void> {
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
    h.setUrl(url);
    const audio = new Audio(url);
    h.setAudio(audio);
    audio.onended = h.onEnd;
    audio.onerror = h.onEnd;
    h.onPlaying();
    await audio.play();
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.error("TTS error:", err);
    }
    h.onEnd();
  }
}
