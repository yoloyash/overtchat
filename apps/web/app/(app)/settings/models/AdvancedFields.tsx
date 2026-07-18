"use client";

import { useState } from "react";
import Editor from "react-simple-code-editor";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SettingsRow, SettingsSection } from "../_components/SettingsRows";

function parseProviderOptions(text: string): string | null {
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
  providerOptionsText: string;
  onProviderOptionsTextChange: (
    next: string,
    parseError: string | null,
  ) => void;
  /** Open by default when editing a model that already has these fields populated. */
  defaultOpen?: boolean;
}

export function AdvancedFields({
  systemPrompt,
  onSystemPromptChange,
  providerOptionsText,
  onProviderOptionsTextChange,
  defaultOpen,
}: AdvancedFieldsProps) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const providerOptionsError = parseProviderOptions(providerOptionsText);

  function handleProviderOptionsBlur() {
    if (!providerOptionsText.trim() || providerOptionsError) return;
    try {
      const formatted = JSON.stringify(JSON.parse(providerOptionsText), null, 2);
      if (formatted !== providerOptionsText) {
        onProviderOptionsTextChange(formatted, null);
      }
    } catch {
      // Invalid JSON is already reported live.
    }
  }

  return (
    <SettingsSection
      title="Advanced"
      description="Optional prompt and provider-specific behavior for this model."
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
              "motion-transform",
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
            title="Provider options"
            description="Optional AI SDK options for the selected provider."
            htmlFor="p-provider-options"
          >
            <div className="space-y-2">
              <div
                className={cn(
                  "rounded-lg border border-input bg-transparent motion-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
                  providerOptionsError &&
                    "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
                )}
              >
                <Editor
                  value={providerOptionsText}
                  onValueChange={(next) =>
                    onProviderOptionsTextChange(
                      next,
                      parseProviderOptions(next),
                    )
                  }
                  highlight={(code) => code}
                  tabSize={2}
                  insertSpaces
                  padding={12}
                  textareaId="p-provider-options"
                  placeholder="{}"
                  onBlur={handleProviderOptionsBlur}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  aria-label="Provider options JSON"
                  aria-invalid={providerOptionsError ? true : undefined}
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
                {providerOptionsError ? (
                  <p className="break-words text-destructive">
                    {providerOptionsError}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Must be a JSON object using the selected provider&apos;s AI
                    SDK option keys.
                  </p>
                )}
              </div>
            </div>
          </SettingsRow>
        </>
      ) : undefined}
    </SettingsSection>
  );
}
