"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ModelCapabilities } from "@overtchat/shared";
import { ArrowLeft, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { DEFAULT_MODEL_SYSTEM_PROMPT } from "@/lib/model-config/defaults";
import {
  ModelConfigSchema,
  type AdminModelConfig,
  type CatalogModelPricing,
  type ModelConfigInput,
  type ModelPricing,
} from "@/lib/model-config/schema";
import { getErrorMessage } from "@/lib/errors";
import {
  useAdminModelConfigs,
  useCreateModelConfig,
  useUpdateModelConfig,
} from "@/lib/queries/modelConfigs";
import { getProvider, PROVIDERS } from "@/lib/providers/catalog";
import {
  AdvancedFields,
  type ModelPricingDraft,
} from "./AdvancedFields";
import { ConnectionFields } from "./ConnectionFields";
import { ConnectionTester } from "./ConnectionTester";
import {
  SettingsActions,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../_components/SettingsRows";

export interface ModelEditorProps {
  /** When provided, editor loads the existing config from cache; otherwise a new one is being created. */
  modelId?: string;
}

type ModelEditorDraft = Omit<ModelConfigInput, "pricing"> & {
  pricing: ModelPricingDraft | null;
};

export function ModelEditor({ modelId }: ModelEditorProps) {
  const router = useRouter();
  const { data: list = [] } = useAdminModelConfigs();
  const existing: AdminModelConfig | undefined = modelId
    ? list.find((m) => m.id === modelId)
    : undefined;
  const isEditing = Boolean(modelId);

  const [draft, setDraft] = useState<ModelEditorDraft>(() => {
    if (existing) {
      return {
        label: existing.label,
        providerId: existing.providerId,
        apiFormat: existing.apiFormat,
        baseUrl: existing.baseUrl,
        apiKey: existing.apiKey ?? "",
        model: existing.model,
        pricing: existing.pricing
          ? pricingDraftFrom(existing.pricing)
          : null,
        contextWindow: existing.contextWindow,
        discoveredContextWindow: existing.discoveredContextWindow,
        discoveredCapabilities: existing.discoveredCapabilities,
        systemPrompt: existing.systemPrompt ?? "",
        providerOptions: existing.providerOptions,
        toolCallingEnabled: existing.toolCallingEnabled !== false,
        enabled: existing.enabled,
        sortOrder: existing.sortOrder,
      };
    }
    return {
      label: "",
      providerId: "openai",
      apiFormat: PROVIDERS.openai.defaultApiFormat,
      baseUrl: PROVIDERS.openai.defaultBaseUrl,
      apiKey: "",
      model: "",
      pricing: null,
      contextWindow: null,
      discoveredContextWindow: null,
      discoveredCapabilities: null,
      systemPrompt: DEFAULT_MODEL_SYSTEM_PROMPT,
      providerOptions: null,
      toolCallingEnabled: true,
      enabled: true,
      sortOrder: 0,
    };
  });

  const [providerOptionsText, setProviderOptionsText] = useState(() =>
    existing?.providerOptions
      ? JSON.stringify(existing.providerOptions, null, 2)
      : "",
  );
  const [providerOptionsError, setProviderOptionsError] = useState<
    string | null
  >(null);
  const [saveError, setSaveError] = useState("");
  // undefined means discovery was not touched in this editor session; null
  // means the current connection did not report a limit.
  const [detectedContextWindow, setDetectedContextWindow] = useState<
    number | null | undefined
  >();
  const [catalogContextWindow, setCatalogContextWindow] = useState<
    number | undefined
  >();
  const [detectedCapabilities, setDetectedCapabilities] = useState<
    ModelCapabilities | null | undefined
  >();
  const [catalogCapabilities, setCatalogCapabilities] = useState<
    ModelCapabilities | undefined
  >();
  const [catalogPricing, setCatalogPricing] = useState<
    CatalogModelPricing | null | undefined
  >();

  const createMut = useCreateModelConfig();
  const updateMut = useUpdateModelConfig();
  const saving = createMut.isPending || updateMut.isPending;

  const requiresKey = getProvider(draft.providerId).requiresApiKey;
  const parsedPricing =
    draft.pricing === null ? null : parsePricingDraft(draft.pricing);
  const pricingIsValid =
    draft.pricing === null || parsedPricing !== null;

  // A new model's prefilled prompt has to be visible to be worth prefilling.
  // When editing, stay collapsed unless the section holds more than the default.
  const advancedDefaultOpen = isEditing
    ? Boolean(
        (existing?.systemPrompt &&
          existing.systemPrompt !== DEFAULT_MODEL_SYSTEM_PROMPT) ||
          existing?.providerOptions ||
          existing?.pricing ||
          existing?.contextWindow,
      )
    : true;

  const canSave =
    !saving &&
    !!draft.baseUrl &&
    !!draft.model &&
    pricingIsValid &&
    !providerOptionsError &&
    !(requiresKey && !draft.apiKey);
  const stillEditingOriginalConnection =
    existing !== undefined &&
    draft.providerId === existing.providerId &&
    draft.apiFormat === existing.apiFormat &&
    draft.baseUrl === existing.baseUrl &&
    draft.model === existing.model;
  const contextWindowPlaceholder =
    detectedContextWindow === undefined
      ? (draft.discoveredContextWindow ?? catalogContextWindow)
      : (detectedContextWindow ?? catalogContextWindow);
  const capabilitiesHint =
    detectedCapabilities === undefined
      ? (draft.discoveredCapabilities ??
        catalogCapabilities ??
        (stillEditingOriginalConnection
          ? existing?.resolvedCapabilities
          : undefined))
      : (detectedCapabilities ?? catalogCapabilities);
  const catalogPricingHint =
    catalogPricing === undefined
      ? stillEditingOriginalConnection
        ? (existing?.catalogPricing ?? undefined)
        : undefined
      : (catalogPricing ?? undefined);

  const pingArgs = useMemo(() => {
    let parsedOptions: Record<string, unknown> | null = null;
    if (providerOptionsText.trim() && !providerOptionsError) {
      try {
        parsedOptions = JSON.parse(providerOptionsText) as Record<
          string,
          unknown
        >;
      } catch {
        parsedOptions = null;
      }
    }
    return {
      providerId: draft.providerId,
      apiFormat: draft.apiFormat,
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey ?? "",
      model: draft.model,
      providerOptions: parsedOptions,
      toolCallingEnabled: draft.toolCallingEnabled,
    };
  }, [
    draft.providerId,
    draft.apiFormat,
    draft.baseUrl,
    draft.apiKey,
    draft.model,
    draft.toolCallingEnabled,
    providerOptionsText,
    providerOptionsError,
  ]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError("");

    let providerOptions: unknown = null;
    if (providerOptionsText.trim()) {
      try {
        providerOptions = JSON.parse(providerOptionsText);
      } catch (err) {
        setSaveError(
          `Provider options must be a valid JSON object: ${getErrorMessage(
            err,
            "Invalid JSON",
          )}`,
        );
        return;
      }
    }

    const pricing =
      draft.pricing === null ? null : parsePricingDraft(draft.pricing);
    if (draft.pricing !== null && pricing === null) {
      setSaveError("Enter all four pricing rates as nonnegative numbers.");
      return;
    }

    const parsed = ModelConfigSchema.safeParse({
      ...draft,
      pricing,
      label: draft.label.trim() || defaultLabelFor(draft.model),
      discoveredContextWindow:
        detectedContextWindow === undefined
          ? draft.discoveredContextWindow
          : detectedContextWindow,
      discoveredCapabilities:
        detectedCapabilities === undefined
          ? draft.discoveredCapabilities
          : detectedCapabilities,
      providerOptions,
    });
    if (!parsed.success) {
      setSaveError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    const input: ModelConfigInput = parsed.data;

    try {
      if (modelId) {
        await updateMut.mutateAsync({ id: modelId, input });
        toast.success({
          title: "Model saved",
          description: input.label,
        });
      } else {
        await createMut.mutateAsync(input);
        toast.success({
          title: "Model created",
          description: input.label,
        });
      }
      router.push("/settings/models");
    } catch (err) {
      setSaveError(getErrorMessage(err, "Failed to save model"));
    }
  }

  return (
    <div className="max-w-4xl">
      <SettingsPageHeader
        className="mb-6"
        title={isEditing ? "Edit model" : "Add model"}
        description="Configure a model that everyone on this server can use."
        leading={
          <Button
            render={<Link href="/settings/models" />}
            variant="ghost"
            size="icon-sm"
            aria-label="Back to models"
          >
            <ArrowLeft />
          </Button>
        }
      />

      <form onSubmit={submit} className="space-y-8">
        <SettingsSection
          title="Connection"
          description="Provider, credentials, model discovery, and connectivity."
        >
          <ConnectionFields
            draft={{
              providerId: draft.providerId,
              apiFormat: draft.apiFormat,
              baseUrl: draft.baseUrl,
              apiKey: draft.apiKey ?? "",
              model: draft.model,
            }}
            onChange={(next) =>
              setDraft((current) => {
                const connectionIdentityChanged =
                  (next.providerId !== undefined &&
                    next.providerId !== current.providerId) ||
                  (next.apiFormat !== undefined &&
                    next.apiFormat !== current.apiFormat) ||
                  (next.baseUrl !== undefined &&
                    next.baseUrl !== current.baseUrl) ||
                  (next.model !== undefined && next.model !== current.model);
                return {
                  ...current,
                  ...next,
                  ...(connectionIdentityChanged
                    ? {
                        contextWindow: null,
                        discoveredContextWindow: null,
                        discoveredCapabilities: null,
                        pricing: null,
                      }
                    : {}),
                };
              })
            }
            onDiscoveredContextWindow={(next) =>
              setDetectedContextWindow(next ?? null)
            }
            onCatalogContextWindow={setCatalogContextWindow}
            onDiscoveredCapabilities={(next) =>
              setDetectedCapabilities(next ?? null)
            }
            onCatalogCapabilities={setCatalogCapabilities}
            onCatalogPricing={(next) =>
              setCatalogPricing(next ?? null)
            }
            onCapabilitySuggestion={(next) => {
              if (
                !isEditing &&
                typeof next?.toolCalling === "boolean"
              ) {
                setDraft((current) => ({
                  ...current,
                  toolCallingEnabled: next.toolCalling ?? true,
                }));
              }
            }}
            autoFetchModels={!isEditing}
          />

          <SettingsRow
            title="Tool calling"
            description={toolCallingDescription(capabilitiesHint)}
            align="center"
            controlAlign="end"
          >
            <Switch
              checked={draft.toolCallingEnabled}
              onCheckedChange={(next) =>
                setDraft((d) => ({ ...d, toolCallingEnabled: next }))
              }
              aria-label={
                draft.toolCallingEnabled
                  ? "Disable tool calling"
                  : "Enable tool calling"
              }
            />
          </SettingsRow>

          <SettingsRow
            title="Test connection"
            description={
              draft.toolCallingEnabled
                ? "Send a short request and verify tool calling with the current connection settings."
                : "Send a short text request with the current connection settings."
            }
            controlAlign="end"
          >
            <ConnectionTester
              key={`${draft.providerId}|${draft.apiFormat}|${draft.baseUrl}|${draft.apiKey}|${draft.model}|${draft.toolCallingEnabled}|${providerOptionsText}`}
              args={pingArgs}
              disabled={requiresKey && !draft.apiKey}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          title="Chat availability"
          description="How this model appears to people using chat."
        >
          <SettingsRow
            title="Display name"
            description="Shown in the chat model picker."
            htmlFor="p-label"
            align="center"
            controlAlign="end"
          >
            <Input
              id="p-label"
              className="w-full @2xl:max-w-xl"
              placeholder={
                draft.model
                  ? defaultLabelFor(draft.model)
                  : "Shown in the picker"
              }
              value={draft.label}
              onChange={(e) =>
                setDraft((d) => ({ ...d, label: e.target.value }))
              }
            />
          </SettingsRow>

          <SettingsRow
            title="Available in chat"
            description="Turn off to keep this model saved without showing it in chat."
            align="center"
            controlAlign="end"
          >
            <Switch
              checked={draft.enabled}
              onCheckedChange={(next) =>
                setDraft((d) => ({ ...d, enabled: next }))
              }
              aria-label={draft.enabled ? "Disable model" : "Enable model"}
            />
          </SettingsRow>
        </SettingsSection>

        <AdvancedFields
          contextWindow={draft.contextWindow}
          onContextWindowChange={(next) =>
            setDraft((d) => ({ ...d, contextWindow: next }))
          }
          contextWindowPlaceholder={contextWindowPlaceholder}
          resolvedContextWindow={
            stillEditingOriginalConnection &&
            detectedContextWindow === undefined
              ? existing.resolvedContextWindow
              : undefined
          }
          pricing={draft.pricing}
          catalogPricing={catalogPricingHint}
          onPricingChange={(next) =>
            setDraft((d) => ({ ...d, pricing: next }))
          }
          systemPrompt={draft.systemPrompt ?? ""}
          onSystemPromptChange={(next) =>
            setDraft((d) => ({ ...d, systemPrompt: next }))
          }
          providerOptionsText={providerOptionsText}
          onProviderOptionsTextChange={(next, err) => {
            setProviderOptionsText(next);
            setProviderOptionsError(err);
          }}
          defaultOpen={advancedDefaultOpen}
        />

        {saveError && (
          <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <XCircle className="size-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{saveError}</span>
          </div>
        )}

        <SettingsActions>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            render={<Link href="/settings/models" />}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSave}>
            {saving ? "Saving…" : isEditing ? "Save" : "Create"}
          </Button>
        </SettingsActions>
      </form>
    </div>
  );
}

function defaultLabelFor(model: string): string {
  if (!model) return "";
  return model.split("/").pop() ?? model;
}

function pricingDraftFrom(pricing: ModelPricing): ModelPricingDraft {
  return {
    input: String(pricing.input),
    output: String(pricing.output),
    cacheRead: String(pricing.cacheRead),
    cacheWrite: String(pricing.cacheWrite),
  };
}

function parsePricingDraft(
  pricing: ModelPricingDraft,
): ModelPricing | null {
  const values = [
    pricing.input,
    pricing.output,
    pricing.cacheRead,
    pricing.cacheWrite,
  ].map((value) => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  });
  if (values.some((value) => value === null)) return null;
  const [input, output, cacheRead, cacheWrite] = values as [
    number,
    number,
    number,
    number,
  ];
  return { input, output, cacheRead, cacheWrite };
}

function toolCallingDescription(
  capabilities: ModelCapabilities | null | undefined,
): string {
  if (capabilities?.toolCalling === true) {
    return "This model or endpoint reports tool support. Test the connection to verify the configured template and parser.";
  }
  if (capabilities?.toolCalling === false) {
    return "This model or endpoint reports no tool support. Override only if the served configuration adds it.";
  }
  return "Allow tools such as web search. Custom servers rarely report this reliably, so use Test connection to verify the served template and parser.";
}
