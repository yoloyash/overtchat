"use client";

import { useState } from "react";
import Editor from "react-simple-code-editor";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ModelPricing } from "@/lib/model-config/schema";
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
  contextWindow: number | null;
  onContextWindowChange: (next: number | null) => void;
  contextWindowPlaceholder?: number;
  resolvedContextWindow?: number;
  pricing: ModelPricing | null;
  onPricingChange: (next: ModelPricing | null) => void;
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
  contextWindow,
  onContextWindowChange,
  contextWindowPlaceholder,
  resolvedContextWindow,
  pricing,
  onPricingChange,
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
            title="Context window"
            description="Maximum tokens this model can hold. Leave blank to use the detected or catalog value."
            htmlFor="p-context-window"
            align="center"
            controlAlign="end"
          >
            <Input
              id="p-context-window"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              className="w-full font-mono @2xl:max-w-xl"
              placeholder={
                contextWindowPlaceholder === undefined &&
                resolvedContextWindow === undefined
                  ? "Automatically detected"
                  : String(
                      contextWindowPlaceholder ?? resolvedContextWindow,
                    )
              }
              value={contextWindow ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                onContextWindowChange(value === "" ? null : Number(value));
              }}
            />
          </SettingsRow>

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
            title="Pricing override"
            description="Custom USD rates per 1M tokens. These replace catalog pricing for future usage."
            align={pricing ? "start" : "center"}
            controlAlign="end"
          >
            <div className="w-full @2xl:max-w-xl">
              <div className="flex min-h-8 items-center justify-end">
                <Switch
                  checked={pricing !== null}
                  onCheckedChange={(enabled) =>
                    onPricingChange(
                      enabled
                        ? {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0,
                          }
                        : null,
                    )
                  }
                  aria-label="Pricing override"
                />
              </div>
              {pricing ? (
                <div className="mt-3 grid grid-cols-2 gap-3 @xl:grid-cols-4">
                  <PricingInput
                    id="p-price-input"
                    label="Input"
                    value={pricing.input}
                    onChange={(input) =>
                      onPricingChange({ ...pricing, input })
                    }
                  />
                  <PricingInput
                    id="p-price-output"
                    label="Output"
                    value={pricing.output}
                    onChange={(output) =>
                      onPricingChange({ ...pricing, output })
                    }
                  />
                  <PricingInput
                    id="p-price-cache-read"
                    label="Cache read"
                    value={pricing.cacheRead}
                    onChange={(cacheRead) =>
                      onPricingChange({ ...pricing, cacheRead })
                    }
                  />
                  <PricingInput
                    id="p-price-cache-write"
                    label="Cache write"
                    value={pricing.cacheWrite}
                    onChange={(cacheWrite) =>
                      onPricingChange({ ...pricing, cacheWrite })
                    }
                  />
                </div>
              ) : null}
            </div>
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

function PricingInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label htmlFor={id} className="min-w-0 space-y-1.5">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <Input
        id={id}
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        className="font-mono"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
