import { type AudioPlayer, createAudioPlayer } from "expo-audio";
import { File as FsFile, Paths } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch, getApiBase } from "@/lib/api";

export type SpeechStatus = "idle" | "loading" | "playing";

export function useSpeech() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<SpeechStatus>("idle");

  const playerRef = useRef<AudioPlayer | null>(null);
  const fileRef = useRef<FsFile | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const subRef = useRef<{ remove: () => void } | null>(null);

  const stop = useCallback(() => {
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
  }, []);

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

      const ac = new AbortController();
      abortRef.current = ac;
      setActiveId(id);
      setStatus("loading");

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
          if (s.playing) setStatus("playing");
        });
        player.play();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          stop();
        }
      }
    },
    [activeId, stop],
  );

  return { activeId, status, play, stop };
}
