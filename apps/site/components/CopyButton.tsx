"use client";

import { Check, CircleAlert, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type CopyStatus = "idle" | "copied" | "error";

export function CopyButton({ value }: { value: string }) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  function resetAfterDelay(delay: number) {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      if (mounted.current) setStatus("idle");
    }, delay);
  }

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);

      if (!mounted.current) return;
      setStatus("copied");
      resetAfterDelay(1800);
    } catch {
      if (!mounted.current) return;
      setStatus("error");
      resetAfterDelay(2400);
    }
  }

  const label =
    status === "copied"
      ? "Copied"
      : status === "error"
        ? "Copy failed"
        : "Copy";

  return (
    <>
      <button
        type="button"
        className="copy-button"
        onClick={copyValue}
        aria-label={`${label} quick start commands`}
      >
        {status === "copied" ? (
          <Check aria-hidden="true" />
        ) : status === "error" ? (
          <CircleAlert aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
        <span>{label}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {status === "copied"
          ? "Quick start commands copied to the clipboard."
          : status === "error"
            ? "Clipboard access was denied. Copy the commands manually."
            : ""}
      </span>
    </>
  );
}
