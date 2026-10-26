import { useEffect, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { toastError } from "@/lib/toast";
import type { useSpeech } from "@/lib/useSpeech";
import { AgentIconButton } from "./AgentPrimitives";

export function useCopied() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  function copy(text: string, failure: string) {
    void Clipboard.setStringAsync(text)
      .then(() => {
        if (!mounted.current) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1200);
      })
      .catch((error) => toastError(failure, error));
  }
  return { copied, copy };
}

export function AgentCopyButton({
  text,
  label = "Copy response",
  copiedLabel = "Copied response",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
}) {
  const { copied, copy } = useCopied();
  return (
    <AgentIconButton
      label={copied ? copiedLabel : label}
      icon={copied ? "checkmark" : "copy-outline"}
      onPress={() => copy(text, `Couldn't ${label.toLowerCase()}`)}
    />
  );
}

export function AgentSpeakButton({
  id,
  text,
  speech,
}: {
  id: string;
  text: string;
  speech: Pick<ReturnType<typeof useSpeech>, "activeId" | "status" | "play">;
}) {
  const spokenText = text.trim();
  if (!spokenText) return null;
  const active = speech.activeId === id;
  const loading = active && speech.status === "loading";
  const tooLong = spokenText.length > 5_000;
  return (
    <AgentIconButton
      label={
        active
          ? loading
            ? "Cancel loading speech"
            : "Stop reading"
          : tooLong
            ? "Read aloud supports up to 5,000 characters"
            : "Read aloud"
      }
      icon={active ? "stop-outline" : "volume-medium-outline"}
      loading={loading}
      disabled={!active && tooLong}
      onPress={() => void speech.play(id, spokenText)}
    />
  );
}
