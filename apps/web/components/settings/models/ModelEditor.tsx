"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { i18n } from "@overtchat/shared/i18n";
import type { ModelCapabilities } from "@overtchat/shared";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { DEFAULT_MODEL_SYSTEM_PROMPT } from "@/lib/model-config/defaults";
import {
  CHAT_ID_PLACEHOLDER,
  modelHeadersFromRows,
} from "@/lib/model-config/headers";
import {
  ModelConfigSchema,
  supportsLocalReasoningConfig,
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
import { findProvider, isProviderId, PROVIDERS } from "@/lib/providers/catalog";
import { ThinkingFields } from "./ThinkingFields";
import {
  AdvancedFields,
  PricingRow,
  type ModelPricingDraft,
} from "./AdvancedFields";
import { ConnectionFields } from "./ConnectionFields";
import { CustomImageFields } from "./CustomImageFields";
import { ConnectionTester } from "./ConnectionTester";
import { UserCredentials } from "./UserCredentials";
import {
  SettingsActions,
  SettingsNotice,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../SettingsRows";
import { RepeatablePairs, pairs, type Pair } from "../RepeatablePairs";

export interface ModelEditorProps {
  /** When provided, editor loads the existing config from cache; otherwise a new one is being created. */
  modelId?: string;
}

type ModelEditorDraft = Omit<ModelConfigInput, "pricing"> & {
  pricing: ModelPricingDraft | null;
};

export function ModelEditor({ modelId }: ModelEditorProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: list = [] } = useAdminModelConfigs();
  const existing: AdminModelConfig | undefined = modelId
    ? list.find((m) => m.id === modelId)
    : undefined;
  const isEditing = Boolean(modelId);

  const [draft, setDraft] = useState<ModelEditorDraft>(() => {
    if (existing) {
      return {
        modelType: existing.modelType,
        label: existing.label,
        providerId: existing.providerId,
        apiFormat: existing.apiFormat,
        baseUrl: existing.baseUrl,
        apiKey: existing.apiKey ?? "",
        model: existing.model,
        pricing: existing.pricing ? pricingDraftFrom(existing.pricing) : null,
        contextWindow: existing.contextWindow,
        discoveredContextWindow: existing.discoveredContextWindow,
        discoveredCapabilities: existing.discoveredCapabilities,
        reasoningOverride: existing.reasoningOverride ?? null,
        systemPrompt: existing.systemPrompt ?? "",
        providerOptions: existing.providerOptions,
        toolCallingEnabled: existing.toolCallingEnabled !== false,
        enabled: existing.enabled,
        credentialScope: existing.credentialScope,
      };
    }
    return {
      modelType: "chat",
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
      reasoningOverride: null,
      systemPrompt: DEFAULT_MODEL_SYSTEM_PROMPT,
      providerOptions: null,
      toolCallingEnabled: true,
      enabled: true,
      credentialScope: "shared",
    };
  });

  const previouslyUsedApiKeys = useMemo(() => {
    if (isEditing) return [];
    const endpoint = draft.baseUrl.trim().replace(/\/+$/, "");
    const keys = list
      .filter(
        (model) =>
          model.providerId === draft.providerId &&
          model.baseUrl.trim().replace(/\/+$/, "") === endpoint,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .flatMap(({ apiKey }) => (apiKey?.trim() ? [apiKey] : []));
    return [...new Set(keys)];
  }, [isEditing, list, draft.providerId, draft.baseUrl]);

  const [headerRows, setHeaderRows] = useState<Pair[]>(() =>
    pairs(existing?.headers ?? {}, false),
  );
  const { headers, error: headersError } = useMemo(
    () => modelHeadersFromRows(headerRows),
    [headerRows],
  );
  const [providerOptionsText, setProviderOptionsText] = useState(() =>
    existing?.providerOptions
      ? JSON.stringify(existing.providerOptions, null, 2)
      : "",
  );
  const [providerOptionsError, setProviderOptionsError] = useState<
    string | null
  >(null);
  const [imageOptionsError, setImageOptionsError] = useState(false);
  const [thinkingInvalid, setThinkingInvalid] = useState(false);
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

  const isImage = draft.modelType === "image";
  const perUser = !isImage && draft.credentialScope === "user";
  const isCustomImage = isImage && draft.providerId === "custom";
  const isOpenRouterImage = isImage && draft.providerId === "openrouter";
  // The server validates providers that the desktop app's catalog predates.
  const requiresKey = findProvider(draft.providerId)?.requiresApiKey ?? false;
  const parsedPricing =
    draft.pricing === null ? null : parsePricingDraft(draft.pricing);
  const pricingIsValid = draft.pricing === null || parsedPricing !== null;

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
    !(thinkingInvalid && draft.reasoningOverride !== null) &&
    !(isCustomImage && imageOptionsError) &&
    !!draft.baseUrl &&
    !!draft.model &&
    pricingIsValid &&
    !headersError &&
    (isImage || !providerOptionsError) &&
    !(requiresKey && !draft.apiKey && !perUser);
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
      headers,
      model: draft.model,
      providerOptions: parsedOptions,
      toolCallingEnabled: draft.toolCallingEnabled,
    };
  }, [
    draft.providerId,
    draft.apiFormat,
    draft.baseUrl,
    draft.apiKey,
    headers,
    draft.model,
    draft.toolCallingEnabled,
    providerOptionsText,
    providerOptionsError,
  ]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError("");

    let providerOptions: unknown = isCustomImage ? draft.providerOptions : null;
    if (!isImage && providerOptionsText.trim()) {
      try {
        providerOptions = JSON.parse(providerOptionsText);
      } catch (err) {
        setSaveError(
          t("models.editor.errors.invalidProviderOptions", {
            error: getErrorMessage(err, t("models.editor.errors.invalidJson")),
          }),
        );
        return;
      }
    }

    const pricing =
      draft.pricing === null ? null : parsePricingDraft(draft.pricing);
    if (draft.pricing !== null && pricing === null) {
      setSaveError(
        isImage
          ? t("models.editor.errors.invalidImagePricing")
          : t("models.editor.errors.invalidChatPricing"),
      );
      return;
    }

    if (!isProviderId(draft.providerId)) {
      setSaveError(
        t("models.editor.errors.updateAppForProvider", {
          provider: existing?.displayProvider ?? draft.providerId,
        }),
      );
      return;
    }

    if (headersError) {
      setSaveError(headersError);
      return;
    }

    const parsed = ModelConfigSchema.safeParse({
      ...draft,
      headers,
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
      credentialScope: isImage ? "shared" : draft.credentialScope,
      ...(isImage
        ? {
            contextWindow: null,
            discoveredContextWindow: null,
            discoveredCapabilities: null,
          }
        : {}),
    });
    if (!parsed.success) {
      setSaveError(
        parsed.error.issues[0]?.message ?? t("models.editor.errors.invalidInput"),
      );
      return;
    }
    const input: ModelConfigInput = parsed.data;

    try {
      if (modelId) {
        await updateMut.mutateAsync({ id: modelId, input });
        toast.success({
          title: t("models.toast.saved"),
          description: input.label,
        });
      } else {
        await createMut.mutateAsync(input);
        toast.success({
          title: t("models.toast.created"),
          description: input.label,
        });
      }
      void navigate({ to: "/settings/models" });
    } catch (err) {
      setSaveError(getErrorMessage(err, t("models.toast.saveFailed")));
    }
  }

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={
          isEditing ? t("models.editor.editTitle") : t("models.editor.addTitle")
        }
        description={t("models.editor.description")}
        leading={
          <Button
            render={<Link to="/settings/models" />}
            variant="ghost"
            size="icon-sm"
            aria-label={t("models.editor.backLabel")}
          >
            <ArrowLeft />
          </Button>
        }
      />

      <form onSubmit={submit} className="space-y-8">
        <SettingsSection title={t("models.editor.modelTypeSection")}>
          <SettingsRow
            title={t("models.editor.typeTitle")}
            htmlFor="p-model-type"
            description={t("models.editor.typeDescription")}
          >
            <Select
              value={draft.modelType}
              onValueChange={(value) => {
                if (value !== "chat" && value !== "image") return;
                setImageOptionsError(false);
                setProviderOptionsText("");
                setProviderOptionsError(null);
                setDraft((current) => ({
                  ...current,
                  modelType: value,
                  reasoningOverride: null,
                  providerOptions: null,
                  pricing: null,
                  ...(current.providerId === "custom"
                    ? {
                        apiFormat:
                          value === "image" ? "openai-images" : "openai-chat",
                      }
                    : {}),
                  ...(value === "image" &&
                  current.providerId !== "openai" &&
                  current.providerId !== "google" &&
                  current.providerId !== "openrouter" &&
                  current.providerId !== "custom"
                    ? {
                        providerId: "openai",
                        apiFormat: "auto",
                        baseUrl: PROVIDERS.openai.defaultBaseUrl,
                        apiKey: "",
                        model: "",
                      }
                    : {}),
                }));
              }}
            >
              <SelectTrigger id="p-model-type">
                <SelectValue>
                  {isImage
                    ? t("models.editor.typeImage")
                    : t("models.editor.typeChat")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">
                  {t("models.editor.typeChat")}
                </SelectItem>
                <SelectItem value="image">
                  {t("models.editor.typeImage")}
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsSection>
        <SettingsSection
          title={t("models.editor.connectionTitle")}
          description={t("models.editor.connectionDescription")}
        >
          <ConnectionFields
            key={draft.modelType}
            imageModel={isImage}
            apiKeyOptional={perUser}
            providerLabel={existing?.displayProvider}
            previouslyUsedApiKeys={previouslyUsedApiKeys}
            draft={{
              providerId: draft.providerId,
              apiFormat: draft.apiFormat,
              baseUrl: draft.baseUrl,
              apiKey: draft.apiKey ?? "",
              model: draft.model,
              headers,
            }}
            onChange={(next) => {
              if (next.providerId) setImageOptionsError(false);
              // Like the API key, headers belong to the provider they were
              // entered for and must not follow the form to another one.
              if (next.providerId && next.providerId !== draft.providerId)
                setHeaderRows([]);
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
                  ...(next.providerId && next.providerId !== current.providerId
                    ? { providerOptions: null }
                    : {}),
                  ...(connectionIdentityChanged
                    ? {
                        contextWindow: null,
                        discoveredContextWindow: null,
                        discoveredCapabilities: null,
                        reasoningOverride: null,
                        pricing: null,
                      }
                    : {}),
                };
              });
            }}
            onDiscoveredContextWindow={(next) =>
              setDetectedContextWindow(next ?? null)
            }
            onCatalogContextWindow={setCatalogContextWindow}
            onDiscoveredCapabilities={(next) =>
              setDetectedCapabilities(next ?? null)
            }
            onCatalogCapabilities={setCatalogCapabilities}
            onCatalogPricing={(next) => setCatalogPricing(next ?? null)}
            onCapabilitySuggestion={(next) => {
              if (!isEditing && typeof next?.toolCalling === "boolean") {
                setDraft((current) => ({
                  ...current,
                  toolCallingEnabled: next.toolCalling ?? true,
                }));
              }
            }}
            autoFetchModels={!isEditing}
          />

          <RepeatablePairs
            label={t("models.editor.headersLabel")}
            description={
              <Trans
                i18nKey="models.editor.headersDescription"
                values={{ placeholder: CHAT_ID_PLACEHOLDER }}
                components={{ code: <code /> }}
              />
            }
            rows={headerRows}
            keyPlaceholder={t("models.editor.headersKeyPlaceholder")}
            valuePlaceholder={t("models.editor.headersValuePlaceholder")}
            addLabel={t("models.editor.headersAddLabel")}
            allowEmpty
            error={headersError}
            onChange={setHeaderRows}
          />

          {!isImage && (
            <>
              <SettingsRow
                title={t("models.editor.toolCallingTitle")}
                description={toolCallingDescription(capabilitiesHint)}
                align="center"
                controlAlign="end"
                layout="toggle"
              >
                <Switch
                  checked={draft.toolCallingEnabled}
                  onCheckedChange={(next) =>
                    setDraft((d) => ({ ...d, toolCallingEnabled: next }))
                  }
                  aria-label={
                    draft.toolCallingEnabled
                      ? t("models.editor.toolCallingDisableLabel")
                      : t("models.editor.toolCallingEnableLabel")
                  }
                />
              </SettingsRow>

              <SettingsRow
                title={t("models.editor.testConnectionTitle")}
                description={
                  draft.toolCallingEnabled
                    ? t("models.editor.testConnectionWithTools")
                    : t("models.editor.testConnectionTextOnly")
                }
                controlAlign="end"
              >
                <ConnectionTester
                  key={`${draft.providerId}|${draft.apiFormat}|${draft.baseUrl}|${draft.apiKey}|${draft.model}|${draft.toolCallingEnabled}|${providerOptionsText}|${JSON.stringify(headers)}`}
                  args={pingArgs}
                  disabled={(requiresKey && !draft.apiKey) || !!headersError}
                />
              </SettingsRow>
            </>
          )}
        </SettingsSection>

        {isCustomImage && (
          <CustomImageFields
            value={draft.providerOptions}
            onChange={(providerOptions) =>
              setDraft((current) => ({ ...current, providerOptions }))
            }
            onError={setImageOptionsError}
          />
        )}

        <SettingsSection
          title={
            isImage
              ? t("models.editor.imageAvailabilityTitle")
              : t("models.editor.chatAvailabilityTitle")
          }
          description={
            isImage
              ? t("models.editor.imageAvailabilityDescription")
              : t("models.editor.chatAvailabilityDescription")
          }
        >
          <SettingsRow
            title={t("models.editor.displayNameTitle")}
            description={
              isImage
                ? t("models.editor.displayNameImageDescription")
                : t("models.editor.displayNameChatDescription")
            }
            htmlFor="p-label"
            align="center"
            controlAlign="end"
          >
            <Input
              id="p-label"
              className="w-full"
              placeholder={
                draft.model
                  ? defaultLabelFor(draft.model)
                  : t("models.editor.displayNamePlaceholder")
              }
              value={draft.label}
              onChange={(e) =>
                setDraft((d) => ({ ...d, label: e.target.value }))
              }
            />
          </SettingsRow>

          {!isImage && (
            <SettingsRow
              title={t("models.editor.credentialsTitle")}
              htmlFor="p-credential-scope"
              description={
                perUser
                  ? t("models.editor.credentialsUserDescription")
                  : t("models.editor.credentialsSharedDescription")
              }
            >
              <Select
                value={draft.credentialScope ?? "shared"}
                onValueChange={(value) => {
                  if (value !== "shared" && value !== "user") return;
                  setDraft((d) => ({ ...d, credentialScope: value }));
                }}
              >
                <SelectTrigger id="p-credential-scope">
                  <SelectValue>
                    {perUser
                      ? t("models.editor.credentialsUser")
                      : t("models.editor.credentialsShared")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="shared">
                    {t("models.editor.credentialsShared")}
                  </SelectItem>
                  <SelectItem value="user">
                    {t("models.editor.credentialsUser")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          )}

          <SettingsRow
            title={
              isImage
                ? t("models.editor.enabledTitle")
                : t("models.editor.availableInChatTitle")
            }
            description={
              isImage
                ? t("models.editor.enabledImageDescription")
                : t("models.editor.availableInChatDescription")
            }
            align="center"
            controlAlign="end"
            layout="toggle"
          >
            <Switch
              checked={draft.enabled}
              onCheckedChange={(next) =>
                setDraft((d) => ({ ...d, enabled: next }))
              }
              aria-label={
                draft.enabled
                  ? t("models.editor.disableModelLabel")
                  : t("models.editor.enableModelLabel")
              }
            />
          </SettingsRow>
        </SettingsSection>

        {isImage && (
          <SettingsSection
            title={t("models.editor.usageCostTitle")}
            description={
              isOpenRouterImage
                ? t("models.editor.usageCostOpenRouter")
                : isCustomImage
                  ? t("models.editor.usageCostCustom")
                  : t("models.editor.usageCostDefault")
            }
          >
            {isOpenRouterImage ? (
              <SettingsNotice>
                {t("models.editor.usageCostOpenRouterNotice")}
              </SettingsNotice>
            ) : (
              <PricingRow
                pricing={draft.pricing}
                catalogPricing={catalogPricingHint}
                onPricingChange={(next) =>
                  setDraft((d) => ({ ...d, pricing: next }))
                }
                cacheRates={false}
              />
            )}
          </SettingsSection>
        )}

        {!isImage && (
          <>
            {supportsLocalReasoningConfig(
              draft.providerId,
              draft.apiFormat,
            ) && (
              <ThinkingFields
                automatic={
                  (detectedCapabilities === undefined
                    ? draft.discoveredCapabilities?.reasoningControls
                    : detectedCapabilities?.reasoningControls) ??
                  catalogCapabilities?.reasoningControls
                }
                value={draft.reasoningOverride}
                onChange={(reasoningOverride) =>
                  setDraft((current) => ({ ...current, reasoningOverride }))
                }
                onInvalidChange={setThinkingInvalid}
                checkTarget={
                  (draft.providerId === "vllm" ||
                    draft.providerId === "llamacpp") &&
                  draft.baseUrl &&
                  draft.model
                    ? {
                        providerId: draft.providerId,
                        apiFormat: draft.apiFormat,
                        baseUrl: draft.baseUrl,
                        apiKey: draft.apiKey,
                        headers,
                        model: draft.model,
                      }
                    : undefined
                }
              />
            )}
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
          </>
        )}

        {saveError && <SettingsNotice tone="error">{saveError}</SettingsNotice>}

        <SettingsActions>
          <Button
            type="button"
            variant="outline"
            render={<Link to="/settings/models" />}
          >
            {t("models.editor.cancel")}
          </Button>
          <Button type="submit" disabled={!canSave}>
            {saving
              ? t("models.editor.saving")
              : isEditing
                ? t("models.editor.saveChanges")
                : t("models.editor.addModel")}
          </Button>
        </SettingsActions>
      </form>

      {/* Outside the model form: each person's credential saves on its own. */}
      {perUser &&
        (modelId && existing?.credentialScope === "user" ? (
          <UserCredentials modelId={modelId} defaultBaseUrl={draft.baseUrl} />
        ) : (
          <SettingsNotice>
            {t("models.editor.perUserSaveFirst")}
          </SettingsNotice>
        ))}
    </SettingsPage>
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

function parsePricingDraft(pricing: ModelPricingDraft): ModelPricing | null {
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
    return i18n.t("models.editor.toolCallingSupported");
  }
  if (capabilities?.toolCalling === false) {
    return i18n.t("models.editor.toolCallingUnsupported");
  }
  return i18n.t("models.editor.toolCallingUnknown");
}
