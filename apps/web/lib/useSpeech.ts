"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechStatus = "idle" | "loading" | "playing" | "paused";

const MIME = "audio/mpeg";

type MSCtor = typeof MediaSource & { isTypeSupported(t: string): boolean };

// Safari 17.1+ only streams audio through ManagedMediaSource, not MediaSource.
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
  // While streaming, audio.duration is Infinity and seeking corrupts the
  // source buffer; flips true once endOfStream() (or the blob load) completes.
  const [canSeek, setCanSeek] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastPlayedRef = useRef<{ id: string; text: string } | null>(null);

  const teardown = useCallback(() => {
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
    const audio = audioRef.current;
    if (audio) {
      // Clear before pause()/load() so teardown's pause event doesn't bounce
      // status back to "paused" after we set "idle".
      audio.onended = null;
      audio.onerror = null;
      audio.onpause = null;
      audio.onplay = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setActiveId(null);
    setStatus("idle");
    setCanSeek(false);
  }, []);

  const stop = useCallback(() => {
    teardown();
    setError(null);
    lastPlayedRef.current = null;
  }, [teardown]);

  useEffect(() => stop, [stop]);

  // Must run synchronously in a user-gesture handler — mobile browsers reject
  // Audio.play() if any await lands between the tap and the call.
  const play = useCallback(
    (id: string, text: string) => {
      if (activeId === id) {
        stop();
        return;
      }
      stop();
      if (!text.trim()) return;
      const audio = audioRef.current;
      if (!audio) {
        console.warn("useSpeech: audioRef not attached");
        return;
      }

      lastPlayedRef.current = { id, text };

      const ac = new AbortController();
      abortRef.current = ac;
      setActiveId(id);
      setStatus("loading");

      const fail = (msg: string) => {
        teardown();
        setError(msg);
      };

      // Wired once so external controls (media-chrome's pause button) keep
      // status in sync.
      audio.onended = () => stop();
      audio.onerror = () => fail("Playback failed.");
      audio.onpause = () => {
        if (audio.src && !audio.ended) setStatus("paused");
      };
      audio.onplay = () => setStatus("playing");

      const MSCtor = getMediaSourceCtor();
      if (!MSCtor) {
        // iOS < 17.1: no MSE, so play() can't fire inside the gesture and
        // mobile autoplay will likely block. Unavoidable.
        void playBlobFallback(audio, text, ac, {
          setUrl: (u) => (urlRef.current = u),
          onComplete: () => setCanSeek(true),
          onError: fail,
        });
        return;
      }

      const mediaSource = new MSCtor();
      mediaSourceRef.current = mediaSource;
      const url = URL.createObjectURL(mediaSource);
      urlRef.current = url;

      audio.src = url;
      audio.play().catch(() => fail("Couldn't start playback."));

      void streamIntoMediaSource(mediaSource, text, ac, {
        onComplete: () => setCanSeek(true),
        onError: fail,
      });
    },
    [activeId, stop, teardown],
  );

  const retry = useCallback(() => {
    const last = lastPlayedRef.current;
    if (!last) return;
    play(last.id, last.text);
  }, [play]);

  return { activeId, status, canSeek, error, play, stop, retry, audioRef };
}

async function streamIntoMediaSource(
  mediaSource: MediaSource,
  text: string,
  ac: AbortController,
  h: { onComplete: () => void; onError: (msg: string) => void },
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
        h.onError("Audio buffer error.");
      }
    };
    sb.addEventListener("updateend", () => {
      if (queue.length > 0) pump();
      else if (closing && mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
          h.onComplete();
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
            h.onComplete();
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
    if ((err as Error).name === "AbortError") return;
    console.error("TTS stream error:", err);
    h.onError(networkErrorMessage(err));
  }
}

async function playBlobFallback(
  audio: HTMLAudioElement,
  text: string,
  ac: AbortController,
  h: {
    setUrl: (u: string) => void;
    onComplete: () => void;
    onError: (msg: string) => void;
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
    audio.src = url;
    h.onComplete();
    await audio.play();
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    console.error("TTS error:", err);
    h.onError(networkErrorMessage(err));
  }
}

function networkErrorMessage(err: unknown): string {
  const msg = (err as Error)?.message ?? "";
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You're offline.";
  }
  if (msg.includes("TTS failed")) return "Speech service unavailable.";
  return "Network error.";
}
