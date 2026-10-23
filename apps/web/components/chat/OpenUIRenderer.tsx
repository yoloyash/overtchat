"use client";

import {
  Component,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  BuiltinActionType,
  Renderer,
  type ActionEvent,
  type OpenUIError,
} from "@openuidev/react-lang";
import { ThemeProvider, createTheme } from "@openuidev/react-ui";
import { openuiChatLibrary } from "@openuidev/react-ui/genui-lib";
import {
  readOpenUIAction,
  type OpenUIAction,
  type OpenUIFormState,
} from "@overtchat/shared";
import { useState } from "react";
// Loaded with this lazy chunk so chats without interactive UI skip ~360 KB of CSS.
import "@openuidev/react-ui/styles/index.css";

const theme = createTheme({
  fontBody: "var(--font-sans, sans-serif)",
  fontHeading: "var(--font-sans, sans-serif)",
  fontLabel: "var(--font-sans, sans-serif)",
  fontNumbers: "var(--font-sans, sans-serif)",
  fontCode: "var(--font-mono, monospace)",
  background: "var(--background)",
  foreground: "var(--card)",
  popoverBackground: "var(--popover)",
  textNeutralPrimary: "var(--foreground)",
  textNeutralSecondary: "var(--muted-foreground)",
  textNeutralTertiary: "var(--muted-foreground)",
  textNeutralLink: "var(--primary)",
  borderDefault: "var(--border)",
  borderInteractive: "var(--input)",
  borderInteractiveSelected: "var(--ring)",
  interactiveAccentDefault: "var(--primary)",
  interactiveAccentHover: "var(--primary)",
  textAccentPrimary: "var(--primary-foreground)",
  sunk: "var(--muted)",
  sunkLight: "var(--muted)",
});

export interface OpenUIRendererProps {
  messageId: string;
  toolCallId: string;
  code: string;
  isStreaming: boolean;
  fallbackText: string;
  mode: "light" | "dark";
  initialState?: OpenUIFormState;
  onAction?: (action: OpenUIAction) => void;
  onOpenUrl?: (url: string) => void;
}

export function safeOpenUIUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    // Relative links are not meaningful across browser, desktop and native origins.
    const url = new URL(raw);
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function OpenUIFallback({
  text,
  error,
}: {
  text: string;
  error?: string;
}) {
  return (
    <div data-openui-fallback="">
      {error && (
        <p role="status" className="text-sm text-muted-foreground">
          {error}
        </p>
      )}
      {text && <div className="whitespace-pre-wrap text-sm">{text}</div>}
    </div>
  );
}

class RenderBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; code: string },
  { failed: boolean; code: string }
> {
  state = { failed: false, code: this.props.code };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(
    props: { code: string },
    state: { code: string },
  ) {
    return props.code !== state.code
      ? { failed: false, code: props.code }
      : null;
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function OpenUIRenderer(props: OpenUIRendererProps) {
  return (
    <RenderBoundary
      code={props.code}
      fallback={
        <OpenUIFallback
          text={props.fallbackText}
          error="Interactive UI could not be rendered. The readable answer is shown below."
        />
      }
    >
      <OpenUIContent {...props} />
    </RenderBoundary>
  );
}

function OpenUIContent({
  messageId,
  toolCallId,
  code,
  isStreaming,
  fallbackText,
  mode,
  initialState,
  onAction,
  onOpenUrl,
}: OpenUIRendererProps) {
  const [errors, setErrors] = useState<OpenUIError[]>([]);
  const [hasRoot, setHasRoot] = useState(true);
  const sent = useRef(false);
  // The parent removes the callback while a turn is queued/running. Re-enable
  // submission only after that cycle; synchronous double clicks are ignored.
  useEffect(() => {
    if (!onAction) sent.current = false;
  }, [onAction]);
  const handleAction = useCallback(
    (event: ActionEvent) => {
      if (isStreaming) return;
      if (event.type === BuiltinActionType.OpenUrl) {
        const url = safeOpenUIUrl(event.params?.url);
        if (url) {
          if (onOpenUrl) onOpenUrl(url);
          else window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (
        event.type !== BuiltinActionType.ContinueConversation ||
        !onAction ||
        sent.current
      )
        return;
      // The upstream form store includes optional fields with undefined values
      // (for example componentType). Normalize to the actual JSON wire shape.
      const action = readOpenUIAction(
        JSON.parse(
          JSON.stringify({
            messageId,
            toolCallId,
            message: event.humanFriendlyMessage,
            ...(event.params?.context !== undefined
              ? { context: event.params.context }
              : {}),
            ...(event.formName !== undefined
              ? { formName: event.formName }
              : {}),
            ...(event.formState !== undefined
              ? { formState: event.formState }
              : {}),
          }),
        ),
      );
      if (action) {
        sent.current = true;
        onAction(action);
      }
    },
    [messageId, toolCallId, isStreaming, onAction, onOpenUrl],
  );
  // Parser diagnostics can accompany a recovered tree. Preserve that content
  // just as Renderer does; fallback is for no root or runtime failures.
  const failed =
    !isStreaming &&
    (!hasRoot ||
      errors.some(
        (error) => error.source !== "parser" && error.severity !== "warning",
      ));
  return (
    <ThemeProvider mode={mode} lightTheme={theme} darkTheme={theme}>
      <div data-openui-rendered="" data-openui-streaming={String(isStreaming)}>
        <fieldset
          disabled={isStreaming || !onAction}
          className="m-0 min-w-0 border-0 p-0"
        >
          <Renderer
            response={code}
            library={openuiChatLibrary}
            isStreaming={isStreaming}
            initialState={initialState}
            onAction={handleAction}
            onError={setErrors}
            onParseResult={(result) => setHasRoot(!!result?.root)}
          />
        </fieldset>
        {failed && (
          <OpenUIFallback
            text={fallbackText}
            error="Some interactive content could not be rendered. The readable answer is shown below."
          />
        )}
      </div>
    </ThemeProvider>
  );
}
