"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchModelsForProvider } from "@/lib/model-config/client";
import { motionClasses } from "@/lib/motion";
import {
  API_FORMATS,
  EXPLICIT_API_FORMAT_IDS,
  getProvider,
  modelIconForModel,
  PROVIDERS,
  PROVIDER_IDS,
  type ApiFormat,
  type ProviderId,
} from "@/lib/providers/catalog";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { SettingsRow } from "../_components/SettingsRows";

export interface ConnectionDraft {
  providerId: ProviderId;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ConnectionFieldsProps {
  draft: ConnectionDraft;
  onChange: (next: Partial<ConnectionDraft>) => void;
  autoFetchModels?: boolean;
}

export function ConnectionFields({
  draft,
  onChange,
  autoFetchModels = false,
}: ConnectionFieldsProps) {
  const provider = getProvider(draft.providerId);
  const requiresKey = provider.requiresApiKey;

  const [models, setModels] = useState<string[]>([]);
  const [modelMode, setModelMode] = useState<"manual" | "list">("manual");
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState("");
  const lastAutoProbeKeyRef = useRef("");

  const canProbe = Boolean(draft.baseUrl) && !(requiresKey && !draft.apiKey);
  const probeKey = [
    draft.providerId,
    draft.apiFormat,
    draft.baseUrl,
    draft.apiKey,
  ].join("\n");

  function clearProbeState() {
    setModels([]);
    setProbeError("");
    setModelMode("manual");
  }

  const probe = useCallback(
    async (connection: ConnectionDraft) => {
      if (!connection.baseUrl) return;
      setProbing(true);
      setProbeError("");
      try {
        const ids = await fetchModelsForProvider({
          providerId: connection.providerId,
          apiFormat: connection.apiFormat,
          baseUrl: connection.baseUrl,
          apiKey: connection.apiKey,
        });
        setModels(ids);
        if (ids.length === 0) {
          setModelMode("manual");
        } else if (!draft.model) {
          onChange({ model: ids[0] });
          setModelMode("list");
        } else if (ids.includes(draft.model)) {
          setModelMode("list");
        } else {
          setModelMode("manual");
        }
      } catch (e) {
        setModels([]);
        setModelMode("manual");
        setProbeError(e instanceof Error ? e.message : String(e));
      } finally {
        setProbing(false);
      }
    },
    [draft.model, onChange],
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
    const t = setTimeout(() => {
      lastAutoProbeKeyRef.current = probeKey;
      void runAutoProbe();
    }, 500);
    return () => clearTimeout(t);
  }, [autoFetchModels, canProbe, probeKey]);

  const currentModelWasFetched = models.includes(draft.model);
  const currentModelIsManual =
    models.length > 0 && draft.model && !currentModelWasFetched;
  const showList = modelMode === "list" && models.length > 0;

  return (
    <>
      <SettingsRow
        title="Provider"
        description="Selects model discovery, authentication, and runtime behavior."
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
              apiFormat: selected.defaultApiFormat,
              baseUrl: selected.defaultBaseUrl,
              apiKey: "",
              model: "",
            });
            clearProbeState();
          }}
        >
          <SelectTrigger id="p-provider" className="w-full @2xl:max-w-xl">
            <ModelBrandIcon iconId={provider.iconId} />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_IDS.map((id) => (
              <SelectItem key={id} value={id}>
                <ModelBrandIcon iconId={PROVIDERS[id].iconId} />
                {PROVIDERS[id].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {draft.providerId === "custom" && (
        <SettingsRow
          title="API format"
          description={
            draft.apiFormat === "auto"
              ? "Choose the protocol exposed by this endpoint."
              : API_FORMATS[draft.apiFormat].description
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
            <SelectTrigger id="p-api-format" className="w-full @2xl:max-w-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPLICIT_API_FORMAT_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {API_FORMATS[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      )}

      <SettingsRow
        title="Endpoint"
        description="Base URL for the model API."
        htmlFor="p-base-url"
        align="center"
        controlAlign="end"
      >
        <Input
          id="p-base-url"
          className="w-full @2xl:max-w-xl"
          placeholder={provider.defaultBaseUrl || "https://api.example.com/v1"}
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
        title="API key"
        description={
          requiresKey
            ? `Required for ${provider.label}.`
            : "Optional for local or custom endpoints."
        }
        htmlFor="p-api-key"
        align="center"
        controlAlign="end"
      >
        <div className="w-full @2xl:max-w-xl">
          <PasswordInput
            id="p-api-key"
            autoComplete="new-password"
            placeholder={requiresKey ? "Required" : "Optional"}
            required={requiresKey}
            value={draft.apiKey}
            onChange={(e) => {
              onChange({ apiKey: e.target.value });
              clearProbeState();
            }}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        title="Model"
        description="Choose a fetched model or enter an id."
        htmlFor="p-model"
        controlAlign="end"
      >
        <div className="w-full space-y-2 @2xl:max-w-xl">
          <div className="flex flex-col gap-2 @lg:flex-row">
            {showList ? (
              <Select
                value={draft.model}
                onValueChange={(value) => {
                  if (value == null) return;
                  onChange({ model: value });
                }}
              >
                <SelectTrigger id="p-model" className="min-w-0 flex-1">
                  <ModelBrandIcon iconId={modelIconForModel(draft.model)} />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m} value={m}>
                      <ModelBrandIcon iconId={modelIconForModel(m)} />
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="p-model"
                className="min-w-0 flex-1 font-mono text-xs"
                placeholder={provider.modelPlaceholder}
                required
                value={draft.model}
                onChange={(e) => {
                  setModelMode("manual");
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
              {models.length > 0 ? "Refresh" : "Fetch"}
            </Button>
          </div>

          <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {probing ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2 className={`size-3 ${motionClasses.spinner}`} />
                Fetching available models
              </span>
            ) : models.length > 0 ? (
              <span className="text-muted-foreground">
                {models.length} model{models.length === 1 ? "" : "s"} fetched
              </span>
            ) : probeError ? (
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertCircle className="size-3" />
                {probeError}
              </span>
            ) : requiresKey && !draft.apiKey ? (
              <span className="text-muted-foreground">
                Add an API key to fetch models.
              </span>
            ) : (
              <span className="text-muted-foreground">
                {autoFetchModels
                  ? "Models will load automatically when ready."
                  : "Refresh to load available models."}
              </span>
            )}

            {models.length > 0 && showList && (
              <button
                type="button"
                className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setModelMode("manual")}
              >
                Enter manually
              </button>
            )}
            {models.length > 0 && !showList && (
              <button
                type="button"
                className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setModelMode("list");
                  if (!currentModelWasFetched) onChange({ model: models[0] });
                }}
              >
                Choose fetched model
              </button>
            )}
          </div>

          {currentModelIsManual && (
            <p className="text-xs leading-5 text-muted-foreground">
              The current model id was not returned by the endpoint, so it is
              being kept as a manual entry.
            </p>
          )}
        </div>
      </SettingsRow>
    </>
  );
}
