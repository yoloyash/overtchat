"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type DictationStatus = "idle" | "recording" | "transcribing";

export type DictationError =
  | { kind: "permission" }
  | { kind: "unsupported" }
  | { kind: "stt_unavailable"; role: "admin" | "user" }
  | { kind: "empty" }
  | { kind: "other"; message: string };

const PREFERRED_MIME = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of PREFERRED_MIME) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

export function useDictation(onResult: (text: string) => void) {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [error, setError] = useState<DictationError | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError({ kind: "unsupported" });
      return;
    }
    const mimeType = pickMime();
    if (!mimeType) {
      setError({ kind: "unsupported" });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      setError({ kind: "permission" });
      return;
    }

    cancelledRef.current = false;
    chunksRef.current = [];
    streamRef.current = stream;

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      cleanupStream();

      if (cancelledRef.current || blob.size === 0) {
        setStatus("idle");
        if (blob.size === 0 && !cancelledRef.current) {
          setError({ kind: "empty" });
        }
        return;
      }

      setStatus("transcribing");
      try {
        const ext = mimeType.includes("webm")
          ? "webm"
          : mimeType.includes("mp4")
            ? "m4a"
            : "ogg";
        const fd = new FormData();
        fd.append("file", blob, `dictation.${ext}`);
        const res = await fetch("/api/transcribe", { method: "POST", body: fd });

        if (res.status === 503) {
          const j = (await res.json().catch(() => ({}))) as {
            role?: "admin" | "user";
          };
          setError({ kind: "stt_unavailable", role: j.role ?? "user" });
          setStatus("idle");
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          setError({ kind: "other", message: text || `HTTP ${res.status}` });
          setStatus("idle");
          return;
        }

        const j = (await res.json().catch(() => ({}))) as { text?: string };
        const out = (j.text ?? "").trim();
        if (out) onResult(out);
        else setError({ kind: "empty" });
      } catch (e) {
        setError({
          kind: "other",
          message: e instanceof Error ? e.message : "Transcription failed",
        });
      } finally {
        setStatus("idle");
      }
    };

    recorder.start();
    setStatus("recording");
  }, [cleanupStream, onResult]);

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
    setStatus("idle");
    setError(null);
  }, []);

  return { status, error, start, stop, cancel, clearError: () => setError(null) };
}
