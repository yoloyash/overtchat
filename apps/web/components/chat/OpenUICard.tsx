"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import {
  normalizeOpenUILang,
  type OpenUIToolPart,
} from "@overtchat/shared";
// Prevent @openuidev/react-lang from auto-mounting its promotional DevTools overlay in dev.
(globalThis as Record<symbol, unknown>)[
  Symbol.for("openui.devtools.autoMount")
] = true;

const OpenUIRenderer = dynamic(() => import("./OpenUIRenderer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      <span>Loading interactive UI…</span>
    </div>
  ),
});

export function OpenUICard({
  part,
  streaming,
  onSendPrompt,
}: {
  part: OpenUIToolPart;
  streaming: boolean;
  onSendPrompt?: (text: string) => void;
}) {
  const pending =
    part.state === "input-streaming" || part.state === "input-available";
  const isStreaming = streaming && pending;
  const code = normalizeOpenUILang(part.input?.ui ?? part.rawInput?.ui);

  return (
    <div className="my-3 w-full space-y-2" data-openui-card="">
      {isStreaming && !code.trim() && (
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-3.5 animate-spin" />
          <span>Building interactive UI…</span>
        </div>
      )}
      {part.state === "output-error" && !code.trim() && (
        <p className="text-sm text-destructive" role="alert">
          {part.errorText ?? "The interactive UI could not be rendered."}
        </p>
      )}
      {code.trim().length > 0 && (
        <OpenUIRenderer
          toolCallId={part.toolCallId}
          code={code}
          isStreaming={isStreaming}
          onSendPrompt={onSendPrompt}
        />
      )}
    </div>
  );
}
