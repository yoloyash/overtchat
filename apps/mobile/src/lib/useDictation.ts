import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File as FsFile } from "expo-file-system";
import { useCallback, useState } from "react";
import { authFetch, getApiBase } from "@/lib/api";

export type DictationStatus = "idle" | "recording" | "transcribing";

export type DictationError =
  | { kind: "permission" }
  | { kind: "unsupported" }
  | { kind: "stt_unavailable"; role: "admin" | "user" }
  | { kind: "empty" }
  | { kind: "other"; message: string };

export function useDictation(onResult: (text: string) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [error, setError] = useState<DictationError | null>(null);

  const start = useCallback(async () => {
    setError(null);
    const perm = await requestRecordingPermissionsAsync().catch(() => null);
    if (!perm?.granted) {
      setError({ kind: "permission" });
      return;
    }

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStatus("recording");
    } catch (e) {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
      }).catch(() => {});
      setError({
        kind: "other",
        message: e instanceof Error ? e.message : "Could not start recording",
      });
      setStatus("idle");
    }
  }, [recorder]);

  const stop = useCallback(async () => {
    if (status !== "recording") return;
    try {
      await recorder.stop();
    } catch {
      // ignore — fall through to upload using whatever uri exists
    }
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
    }).catch(() => {});

    const uri = recorder.uri;
    if (!uri) {
      setStatus("idle");
      return;
    }

    setStatus("transcribing");

    try {
      const fsFile = new FsFile(uri);
      const form = new FormData();
      form.append("file", fsFile as unknown as Blob, "dictation.m4a");

      const res = await authFetch(`${getApiBase()}/api/transcribe`, {
        method: "POST",
        body: form,
      });

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
      try {
        if (uri) new FsFile(uri).delete();
      } catch {
        // best-effort cleanup
      }
    }
  }, [recorder, onResult, status]);

  return {
    status,
    error,
    start,
    stop,
    clearError: () => setError(null),
  };
}
