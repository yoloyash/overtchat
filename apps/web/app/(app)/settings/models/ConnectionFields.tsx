"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { fetchModelsForEndpoint } from "@/lib/config";
import {
  modelIconForModel,
  PRESETS,
  PRESET_IDS,
  providerIconForPreset,
  type PresetId,
} from "@/lib/providers/meta";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { SettingsRow } from "../_components/SettingsRows";

export interface ConnectionDraft {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ConnectionFieldsProps {
  draft: ConnectionDraft;
  onChange: (next: Partial<ConnectionDraft>) => void;
  preset: PresetId;
  onPresetChange?: (next: PresetId) => void;
  autoFetchModels?: boolean;
}

export function ConnectionFields({
  draft,
  onChange,
  preset,
  onPresetChange,
  autoFetchModels = false,
}: ConnectionFieldsProps) {
  const requiresKey = preset !== "custom";
  const presetMeta = PRESETS[preset];
  const presetIconId = providerIconForPreset(preset);

  const [models, setModels] = useState<string[]>([]);
  const [modelMode, setModelMode] = useState<"manual" | "list">("manual");
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState("");
  const lastAutoProbeKeyRef = useRef("");

  const canProbe = Boolean(draft.baseUrl) && !(requiresKey && !draft.apiKey);
  const probeKey = `${draft.baseUrl}\n${draft.apiKey}`;

  function clearProbeState() {
    setModels([]);
    setProbeError("");
    setModelMode("manual");
  }

  const probe = useCallback(
    async (baseUrl: string, apiKey: string) => {
      if (!baseUrl) return;
      setProbing(true);
      setProbeError("");
      try {
        const ids = await fetchModelsForEndpoint(baseUrl, apiKey);
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

  useEffect(() => {
    if (
      !autoFetchModels ||
      !canProbe ||
      lastAutoProbeKeyRef.current === probeKey
    ) {
      return;
    }
    lastAutoProbeKeyRef.current = probeKey;
    const t = setTimeout(() => void probe(draft.baseUrl, draft.apiKey), 500);
    return () => clearTimeout(t);
  }, [
    autoFetchModels,
    canProbe,
    draft.apiKey,
    draft.baseUrl,
    probe,
    probeKey,
  ]);

  const currentModelWasFetched = models.includes(draft.model);
  const currentModelIsManual =
    models.length > 0 && draft.model && !currentModelWasFetched;
  const showList = modelMode === "list" && models.length > 0;

  return (
    <>
      <SettingsRow
        title="Provider"
        description="Sets endpoint defaults and picker grouping."
        htmlFor="p-preset"
        align="center"
      >
        <Select
          value={preset}
          onValueChange={(next) => {
            if (!next || next === preset) return;
            onPresetChange?.(next as PresetId);
            clearProbeState();
          }}
        >
          <SelectTrigger id="p-preset" className="w-full">
            <ModelBrandIcon iconId={presetIconId} />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_IDS.map((id) => (
              <SelectItem key={id} value={id}>
                <ModelBrandIcon iconId={providerIconForPreset(id)} />
                {PRESETS[id].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        title="Endpoint"
        description="Base URL for the model API."
        htmlFor="p-base-url"
        align="center"
      >
        <Input
          id="p-base-url"
          placeholder="https://api.openai.com/v1"
          required
          autoFocus={preset === "custom"}
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
            ? "Required for this hosted preset."
            : "Optional for local or custom endpoints."
        }
        htmlFor="p-api-key"
        align="center"
      >
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
      </SettingsRow>

      <SettingsRow
        title="Model"
        description="Choose a fetched model or enter an id."
        htmlFor="p-model"
      >
        <div className="space-y-2">
          <div className="flex flex-col gap-2 lg:flex-row">
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
                className="min-w-0 flex-1 font-mono text-xs md:text-xs"
                placeholder={presetMeta.modelPlaceholder}
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
              onClick={() => void probe(draft.baseUrl, draft.apiKey)}
              className="lg:w-auto"
            >
              {probing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {models.length > 0 ? "Refresh" : "Fetch"}
            </Button>
          </div>

          <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {probing ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
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
