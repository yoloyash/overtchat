"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ModelCapabilities } from "@overtchat/shared";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useComboboxFilter,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchModelsForProvider,
  type AvailableModel,
} from "@/lib/model-config/client";
import type { CatalogModelPricing } from "@/lib/model-config/schema";
import { motionClasses } from "@/lib/motion";
import {
  API_FORMATS,
  EXPLICIT_API_FORMAT_IDS,
  findProvider,
  getProvider,
  modelIconForModel,
  PROVIDERS,
  PROVIDER_IDS,
  type ApiFormat,
  type ProviderId,
} from "@/lib/providers/catalog";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { SettingsRow } from "../SettingsRows";

export interface ConnectionDraft {
  providerId: ProviderId;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Extra request headers; sent with model discovery. */
  headers?: Record<string, string> | null;
}

export interface ConnectionFieldsProps {
  draft: ConnectionDraft;
  previouslyUsedApiKeys?: string[];
  onChange: (next: Partial<ConnectionDraft>) => void;
  onDiscoveredContextWindow?: (next: number | undefined) => void;
  onCatalogContextWindow?: (next: number | undefined) => void;
  onDiscoveredCapabilities?: (next: ModelCapabilities | undefined) => void;
  onCatalogCapabilities?: (next: ModelCapabilities | undefined) => void;
  onCatalogPricing?: (next: CatalogModelPricing | undefined) => void;
  onCapabilitySuggestion?: (next: ModelCapabilities | undefined) => void;
  autoFetchModels?: boolean;
  imageModel?: boolean;
  /** Each person brings their own key (per-user credentials), so this one is optional. */
  apiKeyOptional?: boolean;
  /** Names a provider that the desktop app's bundled catalog predates. */
  providerLabel?: string;
}

export function ConnectionFields({
  draft,
  previouslyUsedApiKeys = [],
  onChange,
  onDiscoveredContextWindow,
  onCatalogContextWindow,
  onDiscoveredCapabilities,
  onCatalogCapabilities,
  onCatalogPricing,
  onCapabilitySuggestion,
  autoFetchModels = false,
  imageModel = false,
  apiKeyOptional = false,
  providerLabel,
}: ConnectionFieldsProps) {
  const { t } = useTranslation();
  // Undefined in a desktop app older than the provider; the server validates it.
  const provider = findProvider(draft.providerId);
  const providerName =
    provider?.id === "custom"
      ? t("models.page.providerCustom")
      : (provider?.label ?? providerLabel ?? draft.providerId);
  const requiresKey = provider?.requiresApiKey ?? false;

  const [models, setModels] = useState<AvailableModel[]>([]);
  const [modelMode, setModelMode] = useState<"manual" | "list">("manual");
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const lastAutoProbeKeyRef = useRef("");
  const { contains } = useComboboxFilter();

  const canProbe = Boolean(draft.baseUrl) && !(requiresKey && !draft.apiKey);
  const probeKey = [
    draft.providerId,
    draft.apiFormat,
    draft.baseUrl,
    draft.apiKey,
  ].join("\n");

  function clearProbeState() {
    lastAutoProbeKeyRef.current = "";
    setModels([]);
    setProbeError("");
    setModelMode("manual");
    onDiscoveredContextWindow?.(undefined);
    onCatalogContextWindow?.(undefined);
    onDiscoveredCapabilities?.(undefined);
    onCatalogCapabilities?.(undefined);
    onCatalogPricing?.(undefined);
    onCapabilitySuggestion?.(undefined);
  }

  const selectDiscoveredModel = useCallback(
    (model: AvailableModel) => {
      onChange({ model: model.id });
      onDiscoveredContextWindow?.(model.contextWindow);
      onCatalogContextWindow?.(model.catalogContextWindow);
      onDiscoveredCapabilities?.(model.capabilities);
      onCatalogCapabilities?.(model.catalogCapabilities);
      onCatalogPricing?.(model.catalogPricing);
      onCapabilitySuggestion?.({
        ...model.catalogCapabilities,
        ...model.capabilities,
      });
    },
    [
      onCapabilitySuggestion,
      onCatalogCapabilities,
      onCatalogContextWindow,
      onCatalogPricing,
      onChange,
      onDiscoveredCapabilities,
      onDiscoveredContextWindow,
    ],
  );

  const probe = useCallback(
    async (connection: ConnectionDraft) => {
      if (!connection.baseUrl) return;
      setProbing(true);
      setProbeError("");
      try {
        const allModels = await fetchModelsForProvider({
          providerId: connection.providerId,
          apiFormat: connection.apiFormat,
          baseUrl: connection.baseUrl,
          apiKey: connection.apiKey,
          headers: connection.headers,
          modelType: imageModel ? "image" : "chat",
        });
        const discovered = imageModel
          ? allModels.filter((model) => {
              const outputs =
                model.capabilities?.outputModalities ??
                model.catalogCapabilities?.outputModalities;
              // Discovery supplies suggestions; admins can enter any model ID.
              return (
                outputs?.includes("image") ?? connection.providerId === "custom"
              );
            })
          : allModels;
        setModels(discovered);
        const current = discovered.find((model) => model.id === draft.model);
        if (discovered.length === 0) {
          onDiscoveredContextWindow?.(undefined);
          onCatalogContextWindow?.(undefined);
          onDiscoveredCapabilities?.(undefined);
          onCatalogCapabilities?.(undefined);
          onCatalogPricing?.(undefined);
          onCapabilitySuggestion?.(undefined);
          setModelMode("manual");
        } else if (!draft.model) {
          selectDiscoveredModel(discovered[0]);
          setModelMode("list");
        } else if (current) {
          onDiscoveredContextWindow?.(current.contextWindow);
          onCatalogContextWindow?.(current.catalogContextWindow);
          onDiscoveredCapabilities?.(current.capabilities);
          onCatalogCapabilities?.(current.catalogCapabilities);
          onCatalogPricing?.(current.catalogPricing);
          onCapabilitySuggestion?.({
            ...current.catalogCapabilities,
            ...current.capabilities,
          });
          setModelMode("list");
        } else {
          onDiscoveredContextWindow?.(undefined);
          onCatalogContextWindow?.(undefined);
          onDiscoveredCapabilities?.(undefined);
          onCatalogCapabilities?.(undefined);
          onCatalogPricing?.(undefined);
          onCapabilitySuggestion?.(undefined);
          setModelMode("manual");
        }
      } catch (e) {
        setModels([]);
        // A transient fetch failure is not evidence that a previously
        // discovered limit changed. Connection edits clear it separately.
        setModelMode("manual");
        setProbeError(e instanceof Error ? e.message : String(e));
      } finally {
        setProbing(false);
      }
    },
    [
      draft.model,
      imageModel,
      onCapabilitySuggestion,
      onCatalogCapabilities,
      onCatalogContextWindow,
      onCatalogPricing,
      onDiscoveredCapabilities,
      onDiscoveredContextWindow,
      selectDiscoveredModel,
    ],
  );

  const runAutoProbe = useEffectEvent(() => probe(draft));

  useEffect(() => {
    if (
      !autoFetchModels ||
      !canProbe ||
      lastAutoProbeKeyRef.current === probeKey
    ) {
      return;
    }
    const timer = setTimeout(() => {
      lastAutoProbeKeyRef.current = probeKey;
      void runAutoProbe();
    }, 500);
    return () => clearTimeout(timer);
  }, [autoFetchModels, canProbe, probeKey]);

  const modelIds = useMemo(() => models.map((model) => model.id), [models]);
  const matchingModelIds = modelQuery
    ? modelIds.filter((id) => contains(id, modelQuery))
    : modelIds;
  const currentModelWasFetched = models.some(
    (model) => model.id === draft.model,
  );
  const currentModelIsManual =
    models.length > 0 && draft.model && !currentModelWasFetched;
  const showList = modelMode === "list" && models.length > 0;

  return (
    <>
      <SettingsRow
        title={t("models.connection.providerTitle")}
        description={t("models.connection.providerDescription")}
        htmlFor="p-provider"
        align="center"
        controlAlign="end"
      >
        <Select
          value={draft.providerId}
          onValueChange={(next) => {
            if (!next || next === draft.providerId) return;
            const selected = getProvider(next as ProviderId);
            onChange({
              providerId: selected.id,
              apiFormat:
                imageModel && selected.id === "custom"
                  ? "openai-images"
                  : selected.defaultApiFormat,
              baseUrl: selected.defaultBaseUrl,
              apiKey: "",
              model: "",
            });
            clearProbeState();
          }}
        >
          <SelectTrigger id="p-provider" className="w-full">
            <ModelBrandIcon iconId={provider?.iconId ?? null} />
            <SelectValue>
              {imageModel && provider?.id === "custom"
                ? t("models.connection.customOpenAiCompatible")
                : providerName}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {!provider && (
              <SelectItem value={draft.providerId}>
                <ModelBrandIcon iconId={null} />
                {providerName}
              </SelectItem>
            )}
            {PROVIDER_IDS.filter(
              (id) =>
                !imageModel ||
                id === "openai" ||
                id === "google" ||
                id === "openrouter" ||
                id === "custom",
            ).map((id) => (
              <SelectItem key={id} value={id}>
                <ModelBrandIcon iconId={PROVIDERS[id].iconId} />
                {imageModel && id === "custom"
                  ? t("models.connection.customOpenAiCompatible")
                  : id === "custom"
                    ? t("models.page.providerCustom")
                    : PROVIDERS[id].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {draft.providerId === "custom" && !imageModel && (
        <SettingsRow
          title={t("models.connection.apiFormatTitle")}
          description={
            draft.apiFormat === "auto"
              ? t("models.connection.apiFormatAutoDescription")
              : t(`models.connection.apiFormatDescriptions.${draft.apiFormat}`)
          }
          htmlFor="p-api-format"
          align="center"
          controlAlign="end"
        >
          <Select
            value={draft.apiFormat}
            onValueChange={(next) => {
              if (!next || next === draft.apiFormat) return;
              onChange({ apiFormat: next as ApiFormat, model: "" });
              clearProbeState();
            }}
          >
            <SelectTrigger id="p-api-format" className="w-full">
              <SelectValue>
                {draft.apiFormat === "auto"
                  ? t("models.connection.apiFormatAutomatic")
                  : API_FORMATS[draft.apiFormat].label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {EXPLICIT_API_FORMAT_IDS.filter(
                (id) => id !== "openai-images",
              ).map((id) => (
                <SelectItem key={id} value={id}>
                  {API_FORMATS[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      )}

      <SettingsRow
        title={t("models.connection.endpointTitle")}
        description={
          provider?.localRuntime
            ? t("models.connection.endpointLocalDescription")
            : t("models.connection.endpointDescription")
        }
        htmlFor="p-base-url"
        align="center"
        controlAlign="end"
      >
        <Input
          id="p-base-url"
          className="w-full"
          // eslint-disable-next-line i18next/no-literal-string -- example URL placeholder
          placeholder={provider?.defaultBaseUrl || "https://api.example.com/v1"}
          required
          autoFocus={draft.providerId === "custom"}
          value={draft.baseUrl}
          onChange={(e) => {
            onChange({ baseUrl: e.target.value });
            clearProbeState();
          }}
        />
      </SettingsRow>

      <SettingsRow
        title={t("models.connection.apiKeyTitle")}
        description={
          apiKeyOptional
            ? t("models.connection.apiKeyOptionalDescription")
            : requiresKey
              ? t("models.connection.apiKeyRequiredFor", {
                  provider: providerName,
                })
              : provider
                ? t("models.connection.apiKeyOptionalLocalDescription")
                : t("models.connection.apiKeyUnknownProvider", {
                    provider: providerName,
                  })
        }
        htmlFor="p-api-key"
        align="center"
        controlAlign="end"
      >
        <div className="w-full">
          <PasswordInput
            id="p-api-key"
            autoComplete="new-password"
            placeholder={
              requiresKey && !apiKeyOptional
                ? t("models.connection.requiredPlaceholder")
                : t("models.connection.optionalPlaceholder")
            }
            required={requiresKey && !apiKeyOptional}
            value={draft.apiKey}
            onChange={(e) => {
              onChange({ apiKey: e.target.value });
              clearProbeState();
            }}
          />
          {!draft.apiKey && previouslyUsedApiKeys.length > 0 && (
            <div
              role="group"
              aria-label={t("models.connection.previouslyUsedGroupLabel")}
              className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
            >
              <span>{t("models.connection.previouslyUsed")}</span>
              {previouslyUsedApiKeys.map((apiKey) => (
                <Button
                  key={apiKey}
                  type="button"
                  variant="link"
                  size="sm"
                  className="px-0 font-mono text-xs text-muted-foreground"
                  onClick={() => {
                    onChange({ apiKey });
                    clearProbeState();
                  }}
                >
                  ····{apiKey.length > 4 ? apiKey.slice(-4) : ""}
                </Button>
              ))}
            </div>
          )}
        </div>
      </SettingsRow>

      <SettingsRow
        title={t("models.connection.modelTitle")}
        description={
          imageModel
            ? t("models.connection.modelImageDescription")
            : t("models.connection.modelChatDescription")
        }
        htmlFor="p-model"
        controlAlign="end"
      >
        <div className="w-full space-y-2">
          <div className="flex flex-col gap-2 @lg:flex-row">
            {showList ? (
              <Combobox
                items={modelIds}
                // Filtered here so every opening starts a fresh search, even
                // when it interrupts the previous close animation.
                filteredItems={matchingModelIds}
                inputValue={modelQuery}
                onInputValueChange={setModelQuery}
                onOpenChange={(open) => {
                  if (open) setModelQuery("");
                }}
                value={draft.model}
                onValueChange={(value) => {
                  if (value == null) return;
                  const model = models.find((item) => item.id === value);
                  if (model) selectDiscoveredModel(model);
                }}
                autoHighlight
              >
                <ComboboxTrigger id="p-model" className="min-w-0 flex-1">
                  <ModelBrandIcon iconId={modelIconForModel(draft.model)} />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {draft.model}
                  </span>
                </ComboboxTrigger>
                <ComboboxContent aria-label={t("models.connection.fetchedModelsLabel")}>
                  <ComboboxInput
                    placeholder={t("models.connection.searchModelsPlaceholder")}
                    aria-label={t("models.connection.searchModelsLabel")}
                  />
                  <ComboboxEmpty>
                    {t("models.connection.noMatchingModels")}
                  </ComboboxEmpty>
                  <ComboboxList>
                    {(id: string) => (
                      <ComboboxItem key={id} value={id}>
                        <ModelBrandIcon iconId={modelIconForModel(id)} />
                        <span className="min-w-0 truncate">{id}</span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            ) : (
              <Input
                id="p-model"
                className="min-w-0 flex-1 font-mono text-xs"
                placeholder={
                  imageModel
                    ? draft.providerId === "custom"
                      ? // eslint-disable-next-line i18next/no-literal-string -- model ID placeholder
                        "model-id"
                      : draft.providerId === "google"
                        ? // eslint-disable-next-line i18next/no-literal-string -- model ID placeholder
                          "gemini-3.1-flash-image"
                        : draft.providerId === "openrouter"
                          ? // eslint-disable-next-line i18next/no-literal-string -- model ID placeholder
                            "google/gemini-2.5-flash-image"
                          : // eslint-disable-next-line i18next/no-literal-string -- model ID placeholder
                            "gpt-image-1"
                    : (provider?.modelPlaceholder ??
                      // eslint-disable-next-line i18next/no-literal-string -- model ID placeholder
                      "model-id")
                }
                required
                value={draft.model}
                onChange={(e) => {
                  setModelMode("manual");
                  onDiscoveredContextWindow?.(undefined);
                  onCatalogContextWindow?.(undefined);
                  onDiscoveredCapabilities?.(undefined);
                  onCatalogCapabilities?.(undefined);
                  onCatalogPricing?.(undefined);
                  onCapabilitySuggestion?.(undefined);
                  onChange({ model: e.target.value });
                }}
              />
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canProbe || probing}
              onClick={() => void probe(draft)}
              className="@lg:w-auto"
            >
              {probing ? (
                <Loader2 className={motionClasses.spinner} />
              ) : (
                <RefreshCw />
              )}
              {models.length > 0
                ? t("models.connection.refresh")
                : t("models.connection.fetch")}
            </Button>
          </div>

          <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {probing ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2 className={`size-3 ${motionClasses.spinner}`} />
                {t("models.connection.fetchingModels")}
              </span>
            ) : models.length > 0 ? (
              <span className="text-muted-foreground">
                {t("models.connection.modelsFetched", { count: models.length })}
              </span>
            ) : probeError ? (
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertCircle className="size-3" />
                {probeError}
              </span>
            ) : requiresKey && !draft.apiKey ? (
              <span className="text-muted-foreground">
                {t("models.connection.addApiKeyToFetch")}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {autoFetchModels
                  ? t("models.connection.autoFetchHint")
                  : t("models.connection.manualFetchHint")}
              </span>
            )}

            {models.length > 0 && showList && (
              <button
                type="button"
                className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setModelMode("manual")}
              >
                {t("models.connection.enterManually")}
              </button>
            )}
            {models.length > 0 && !showList && (
              <button
                type="button"
                className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setModelMode("list");
                  if (!currentModelWasFetched) {
                    selectDiscoveredModel(models[0]);
                  }
                }}
              >
                {t("models.connection.chooseFetchedModel")}
              </button>
            )}
          </div>

          {currentModelIsManual && (
            <p className="text-xs leading-5 text-muted-foreground">
              {t("models.connection.manualModelNotice")}
            </p>
          )}
        </div>
      </SettingsRow>
    </>
  );
}
