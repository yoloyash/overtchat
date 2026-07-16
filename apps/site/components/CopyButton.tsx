"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copyValue() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      className="copy-button"
      onClick={copyValue}
      aria-label={copied ? "Copied quick start commands" : "Copy quick start commands"}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
