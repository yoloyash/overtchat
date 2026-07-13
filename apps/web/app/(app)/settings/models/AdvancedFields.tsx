"use client";

import { useState } from "react";
import Editor from "react-simple-code-editor";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SettingsRow, SettingsSection } from "../_components/SettingsRows";

const EXTRA_BODY_EXAMPLE = {
  chat_template_kwargs: { thinking: true },
};

function parseExtraBody(text: string): string | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return "Must be a JSON object";
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export interface AdvancedFieldsProps {
  systemPrompt: string;
  onSystemPromptChange: (next: string) => void;
  extraBodyText: string;
  onExtraBodyTextChange: (next: string, parseError: string | null) => void;
  /** Open by default when editing a model that already has these fields populated. */
  defaultOpen?: boolean;
}

export function AdvancedFields({
  systemPrompt,
  onSystemPromptChange,
  extraBodyText,
  onExtraBodyTextChange,
  defaultOpen,
}: AdvancedFieldsProps) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const extraBodyError = parseExtraBody(extraBodyText);

  function handleExtraBodyBlur() {
    if (!extraBodyText.trim() || extraBodyError) return;
    try {
      const formatted = JSON.stringify(JSON.parse(extraBodyText), null, 2);
      if (formatted !== extraBodyText) {
        onExtraBodyTextChange(formatted, null);
      }
    } catch {
      // Invalid JSON is already reported live.
    }
  }

  return (
    <SettingsSection
      title="Advanced"
      description="Optional prompt and request-body overrides for this model."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"}
          <ChevronDown
            className={cn(
              "transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </Button>
      }
    >
      {open ? (
        <>
          <SettingsRow
            title="System prompt"
            description="Optional instructions sent before each chat."
            htmlFor="p-system-prompt"
          >
            <Textarea
              id="p-system-prompt"
              rows={4}
              className="min-h-28 resize-y"
              placeholder="You are a helpful assistant…"
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
            />
          </SettingsRow>

          <SettingsRow
            title="Extra body"
            description="Optional JSON object merged into each provider request."
            htmlFor="p-extra"
          >
            <div className="space-y-2">
              <div
                className={cn(
                  "rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
                  extraBodyError &&
                    "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
                )}
              >
                <Editor
                  value={extraBodyText}
                  onValueChange={(next) =>
                    onExtraBodyTextChange(next, parseExtraBody(next))
                  }
                  highlight={(code) => code}
                  tabSize={2}
                  insertSpaces
                  padding={12}
                  textareaId="p-extra"
                  placeholder='{ "chat_template_kwargs": { "thinking": true } }'
                  onBlur={handleExtraBodyBlur}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  aria-label="Extra request body JSON"
                  aria-invalid={extraBodyError ? true : undefined}
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    fontSize: "0.8125rem",
                    lineHeight: "1.55",
                    minHeight: "9rem",
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                {extraBodyError ? (
                  <p className="break-words text-destructive">
                    {extraBodyError}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Must be a JSON object. Leave empty to send no override.
                  </p>
                )}
                {!extraBodyText.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      const formatted = JSON.stringify(
                        EXTRA_BODY_EXAMPLE,
                        null,
                        2,
                      );
                      onExtraBodyTextChange(formatted, null);
                    }}
                    className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Insert example
                  </button>
                )}
              </div>
            </div>
          </SettingsRow>
        </>
      ) : undefined}
    </SettingsSection>
  );
}
