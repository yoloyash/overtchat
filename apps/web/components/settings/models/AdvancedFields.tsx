"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@overtchat/shared/i18n";
import Editor from "react-simple-code-editor";
import { ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogModelPricing } from "@/lib/model-config/schema";
import { cn } from "@/lib/utils";
import { SettingsRow, SettingsSection } from "../SettingsRows";

function parseProviderOptions(text: string): string | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return i18n.t("models.advanced.providerOptionsMustBeObject");
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export interface ModelPricingDraft {
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
}

export interface AdvancedFieldsProps {
  contextWindow: number | null;
  onContextWindowChange: (next: number | null) => void;
  contextWindowPlaceholder?: number;
  resolvedContextWindow?: number;
  pricing: ModelPricingDraft | null;
  catalogPricing?: CatalogModelPricing;
  onPricingChange: (next: ModelPricingDraft | null) => void;
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
  catalogPricing,
  onPricingChange,
  systemPrompt,
  onSystemPromptChange,
  providerOptionsText,
  onProviderOptionsTextChange,
  defaultOpen,
}: AdvancedFieldsProps) {
  const { t } = useTranslation();
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
      title={t("models.advanced.title")}
      description={t("models.advanced.description")}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? t("models.advanced.hide") : t("models.advanced.show")}
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
            title={t("models.advanced.contextWindowTitle")}
            description={t("models.advanced.contextWindowDescription")}
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
              className="w-full font-mono"
              placeholder={
                contextWindowPlaceholder === undefined &&
                resolvedContextWindow === undefined
                  ? t("models.advanced.contextWindowPlaceholder")
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
            title={t("models.advanced.systemPromptTitle")}
            align="start"
            description={t("models.advanced.systemPromptDescription")}
            htmlFor="p-system-prompt"
          >
            <Textarea
              id="p-system-prompt"
              rows={4}
              className="min-h-28 resize-y"
              placeholder={t("models.advanced.systemPromptPlaceholder")}
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
            />
          </SettingsRow>

          <PricingRow
            pricing={pricing}
            catalogPricing={catalogPricing}
            onPricingChange={onPricingChange}
          />

          <SettingsRow
            title={t("models.advanced.providerOptionsTitle")}
            align="start"
            description={t("models.advanced.providerOptionsDescription")}
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
                  aria-label={t("models.advanced.providerOptionsAriaLabel")}
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
                    {t("models.advanced.providerOptionsHint")}
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

export function PricingRow({
  pricing,
  catalogPricing,
  onPricingChange,
  cacheRates = true,
}: {
  pricing: ModelPricingDraft | null;
  catalogPricing?: CatalogModelPricing;
  onPricingChange: (next: ModelPricingDraft | null) => void;
  /** Image usage has no cache tokens, so image models edit input and output only. */
  cacheRates?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <SettingsRow
      title={t("models.advanced.pricing.title")}
      description={t("models.advanced.pricing.description")}
      align={pricing || catalogPricing ? "start" : "center"}
      controlAlign="end"
    >
      <div className="w-full">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {pricing
              ? t("models.advanced.pricing.customRates")
              : catalogPricing
                ? // eslint-disable-next-line i18next/no-literal-string -- catalog site name
                  "models.dev"
                : t("models.advanced.pricing.noCatalogPricing")}
          </span>
          <div className="flex items-center gap-2">
            <label
              htmlFor="p-custom-pricing"
              className="text-xs text-muted-foreground"
            >
              {t("models.advanced.pricing.customPricingLabel")}
            </label>
            <Switch
              id="p-custom-pricing"
              checked={pricing !== null}
              onCheckedChange={(enabled) => {
                if (!enabled) return onPricingChange(null);
                const draft = catalogPricing
                  ? pricingDraftFrom(catalogPricing)
                  : emptyPricingDraft();
                onPricingChange(
                  cacheRates
                    ? draft
                    : { ...draft, cacheRead: "0", cacheWrite: "0" },
                );
              }}
              aria-label={t("models.advanced.pricing.customPricingLabel")}
            />
          </div>
        </div>
        {pricing || catalogPricing ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <PricingInput
              id="p-price-input"
              label={t("models.advanced.pricing.input")}
              value={pricing?.input ?? String(catalogPricing?.input ?? "")}
              readOnly={!pricing}
              onChange={(input) =>
                pricing && onPricingChange({ ...pricing, input })
              }
            />
            <PricingInput
              id="p-price-output"
              label={t("models.advanced.pricing.output")}
              value={pricing?.output ?? String(catalogPricing?.output ?? "")}
              readOnly={!pricing}
              onChange={(output) =>
                pricing && onPricingChange({ ...pricing, output })
              }
            />
            {cacheRates ? (
              <>
                <PricingInput
                  id="p-price-cache-read"
                  label={t("models.advanced.pricing.cacheRead")}
                  value={
                    pricing?.cacheRead ??
                    String(catalogPricing?.cacheRead ?? "")
                  }
                  readOnly={!pricing}
                  onChange={(cacheRead) =>
                    pricing && onPricingChange({ ...pricing, cacheRead })
                  }
                />
                <PricingInput
                  id="p-price-cache-write"
                  label={t("models.advanced.pricing.cacheWrite")}
                  value={
                    pricing?.cacheWrite ??
                    String(catalogPricing?.cacheWrite ?? "")
                  }
                  readOnly={!pricing}
                  onChange={(cacheWrite) =>
                    pricing && onPricingChange({ ...pricing, cacheWrite })
                  }
                />
              </>
            ) : null}
          </div>
        ) : null}
        <div className="mt-2 flex min-h-6 flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {catalogPricing?.tiered
              ? pricing
                ? t("models.advanced.pricing.tieredCustomHint")
                : t("models.advanced.pricing.tieredCatalogHint")
              : pricing
                ? t("models.advanced.pricing.customHint")
                : !catalogPricing
                  ? t("models.advanced.pricing.noCatalogHint")
                  : null}
          </p>
          {pricing ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onPricingChange(null)}
            >
              <RotateCcw />
              {catalogPricing
                ? t("models.advanced.pricing.useCatalogPricing")
                : t("models.advanced.pricing.removeCustomPricing")}
            </Button>
          ) : null}
        </div>
      </div>
    </SettingsRow>
  );
}

function PricingInput({
  id,
  label,
  value,
  readOnly,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  readOnly?: boolean;
  onChange: (next: string) => void;
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
        className={cn(
          "font-mono",
          readOnly && "bg-muted/30 text-muted-foreground",
        )}
        value={value}
        readOnly={readOnly}
        tabIndex={readOnly ? -1 : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function pricingDraftFrom(
  pricing: CatalogModelPricing,
): ModelPricingDraft {
  return {
    input: String(pricing.input),
    output: String(pricing.output),
    cacheRead: String(pricing.cacheRead),
    cacheWrite: String(pricing.cacheWrite),
  };
}

function emptyPricingDraft(): ModelPricingDraft {
  return {
    input: "",
    output: "",
    cacheRead: "",
    cacheWrite: "",
  };
}
