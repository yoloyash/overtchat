"use client";

import { useState } from "react";
import Editor from "react-simple-code-editor";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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
      // already invalid; live error covers it
    }
  }

  return (
    <div className="border-t pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Advanced
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-system-prompt">
              System prompt <OptionalChip />
            </Label>
            <Textarea
              id="p-system-prompt"
              rows={3}
              placeholder="You are a helpful assistant…"
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="p-extra">
                Extra body <OptionalChip />
              </Label>
              {!extraBodyText.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    const formatted = JSON.stringify(EXTRA_BODY_EXAMPLE, null, 2);
                    onExtraBodyTextChange(formatted, null);
                  }}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Insert example
                </button>
              )}
            </div>
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
                padding={8}
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
                  fontSize: "0.75rem",
                  lineHeight: "1.5",
                  minHeight: "8rem",
                }}
              />
            </div>
            {extraBodyError && (
              <p className="text-xs text-destructive break-words">
                {extraBodyError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Provider-specific options forwarded as <code className="font-mono text-[11px]">extra_body</code>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function OptionalChip() {
  return (
    <span className="ml-1 rounded px-1.5 py-px text-[10px] font-normal uppercase tracking-wide text-muted-foreground/80">
      Optional
    </span>
  );
}
