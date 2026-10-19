"use client";

import { useCallback, useState } from "react";
import { useTheme } from "next-themes";
import {
  BuiltinActionType,
  Renderer,
  type ActionEvent,
  type OpenUIError,
} from "@openuidev/react-lang";
import { ThemeProvider, createTheme } from "@openuidev/react-ui";
import { openuiChatLibrary } from "@openuidev/react-ui/genui-lib";

const sharedTypographyTheme = createTheme({
  fontBody: "var(--font-sans)",
  fontHeading: "var(--font-sans)",
  fontLabel: "var(--font-sans)",
  fontNumbers: "var(--font-sans)",
  fontCode: "var(--font-mono)",
});

function unwrapStoreValue(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "value" in value
  ) {
    return value.value;
  }
  return value;
}

export function extractFormFields(
  formState: Record<string, unknown> | undefined,
): Array<[string, unknown]> {
  if (!formState || typeof formState !== "object") return [];
  const fields: Array<[string, unknown]> = [];
  for (const [key, raw] of Object.entries(formState)) {
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !("value" in raw && "componentType" in raw)
    ) {
      for (const [fieldName, fieldEntry] of Object.entries(
        raw as Record<string, unknown>,
      )) {
        const unwrapped = unwrapStoreValue(fieldEntry);
        if (unwrapped !== undefined && unwrapped !== "") {
          fields.push([fieldName, unwrapped]);
        }
      }
      continue;
    }
    const unwrapped = unwrapStoreValue(raw);
    if (unwrapped !== undefined && unwrapped !== "") {
      fields.push([key, unwrapped]);
    }
  }
  return fields;
}

function formatActionPrompt(event: ActionEvent): string {
  const baseMessage =
    event.humanFriendlyMessage ||
    (typeof event.params?.message === "string" ? event.params.message : "");
  const formFields = extractFormFields(
    event.formState as Record<string, unknown> | undefined,
  );
  if (formFields.length > 0) {
    const formattedFields = formFields
      .map(
        ([key, value]) =>
          `- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
      )
      .join("\n");
    return baseMessage
      ? `${baseMessage}\n\nSubmitted form values:\n${formattedFields}`
      : `Submitted form${event.formName ? ` (${event.formName})` : ""}:\n${formattedFields}`;
  }
  return baseMessage;
}

function readPersistedFormState(
  toolCallId: string,
): Record<string, unknown> | undefined {
  if (typeof window === "undefined" || !toolCallId) return undefined;
  try {
    const raw = window.sessionStorage.getItem(
      `overtchat_openui_state:${toolCallId}`,
    );
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export default function OpenUIRenderer({
  toolCallId,
  code,
  isStreaming,
  onSendPrompt,
}: {
  toolCallId: string;
  code: string;
  isStreaming: boolean;
  onSendPrompt?: (text: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const mode = resolvedTheme === "dark" ? "dark" : "light";
  const [errors, setErrors] = useState<OpenUIError[]>([]);
  const [initialState] = useState<Record<string, unknown> | undefined>(() =>
    readPersistedFormState(toolCallId),
  );

  const handleStateUpdate = useCallback(
    (state: Record<string, unknown>) => {
      if (typeof window === "undefined" || !toolCallId) return;
      try {
        window.sessionStorage.setItem(
          `overtchat_openui_state:${toolCallId}`,
          JSON.stringify(state),
        );
      } catch {
        // Ignore storage quota errors.
      }
    },
    [toolCallId],
  );
  const handleAction = useCallback(
    (event: ActionEvent) => {
      if (event.type === BuiltinActionType.OpenUrl) {
        const rawUrl = event.params?.url;
        if (typeof window !== "undefined" && typeof rawUrl === "string") {
          try {
            const parsed = new URL(rawUrl, window.location.href);
            if (/^(https?|mailto|tel):$/i.test(parsed.protocol)) {
              window.open(parsed.href, "_blank", "noopener,noreferrer");
            }
          } catch {
            // Ignore malformed URLs from model output.
          }
        }
        return;
      }

      if (!onSendPrompt) return;
      const prompt = formatActionPrompt(event).trim();
      if (prompt) onSendPrompt(prompt);
    },
    [onSendPrompt],
  );

  const fatalFailure = errors.some(
    (error) =>
      error.severity !== "warning" &&
      (error.code === "parse-failed" ||
        error.code === "no-root" ||
        error.code === "parse-exception"),
  );
  return (
    <ThemeProvider
      mode={mode}
      lightTheme={sharedTypographyTheme}
      darkTheme={sharedTypographyTheme}
    >
      <div
        className="w-full"
        data-openui-rendered=""
        data-openui-streaming={isStreaming ? "true" : "false"}
      >
        <Renderer
          response={code}
          library={openuiChatLibrary}
          isStreaming={isStreaming}
          initialState={initialState}
          onStateUpdate={handleStateUpdate}
          onAction={handleAction}
          onError={setErrors}
        />
        {!isStreaming && fatalFailure && (
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            Interactive UI could not be rendered.
          </p>
        )}
      </div>
    </ThemeProvider>
  );
}
