"use client";

import { Component, lazy, Suspense, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  normalizeOpenUILang,
  openUIFallbackText,
  type OpenUIToolPart,
  type OpenUIAction,
  type OpenUIFormState,
} from "@overtchat/shared";

// Set before the lazy import; in development the upstream overlay loads remote
// assets. Production builds strip it. OpenUICard.test.ts tracks the flag.
(globalThis as Record<symbol, unknown>)[
  Symbol.for("openui.devtools.autoMount")
] = true;
const OpenUIRenderer = lazy(() => import("./OpenUIRenderer"));

class LoadingBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function OpenUICard({
  messageId,
  part,
  streaming,
  initialState,
  onAction,
}: {
  messageId: string;
  part: OpenUIToolPart;
  streaming: boolean;
  initialState?: OpenUIFormState;
  onAction?: (action: OpenUIAction) => void;
}) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const pending =
    part.state === "input-streaming" || part.state === "input-available";
  const isStreaming = streaming && pending;
  const code = normalizeOpenUILang(part.input?.ui ?? part.rawInput?.ui);
  const text = openUIFallbackText(part);
  const failed = part.state === "output-error" || (!streaming && pending);
  const fallback = (
    <div className="whitespace-pre-wrap text-sm" data-openui-fallback="">
      {text || t("chat.openui.unavailable")}
    </div>
  );
  return (
    <div className="my-3 w-full space-y-2" data-openui-card="">
      {isStreaming && !code.trim() && (
        <div
          role="status"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" />
          {t("chat.openui.building")}
        </div>
      )}
      {failed ? (
        <>
          <p className="text-sm text-destructive" role="alert">
            {part.errorText ?? t("chat.openui.interrupted")}
          </p>
          {text && fallback}
        </>
      ) : code.trim() ? (
        <LoadingBoundary key={part.toolCallId} fallback={fallback}>
          <Suspense fallback={<div role="status">{t("chat.openui.loading")}</div>}>
            <OpenUIRenderer
              messageId={messageId}
              toolCallId={part.toolCallId}
              code={code}
              isStreaming={isStreaming}
              fallbackText={text}
              mode={resolvedTheme === "dark" ? "dark" : "light"}
              initialState={initialState}
              onAction={
                part.state === "output-available" ? onAction : undefined
              }
            />
          </Suspense>
        </LoadingBoundary>
      ) : (
        !isStreaming && fallback
      )}
    </div>
  );
}
