"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export interface ConnectionDraft {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ConnectionFieldsProps {
  draft: ConnectionDraft;
  onChange: (next: Partial<ConnectionDraft>) => void;
  /** When null, the preset selector is hidden (edit mode). */
  preset: PresetId | null;
  onPresetChange?: (next: PresetId) => void;
}

export function ConnectionFields({
  draft,
  onChange,
  preset,
  onPresetChange,
}: ConnectionFieldsProps) {
  const requiresKey = preset === null ? false : preset !== "custom";
  const presetMeta = preset === null ? PRESETS.custom : PRESETS[preset];
  const isCreating = preset !== null;
  const presetIconId = preset === null ? null : providerIconForPreset(preset);

  const [models, setModels] = useState<string[]>([]);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState("");

  const probe = useCallback(
    async (baseUrl: string, apiKey: string) => {
      if (!baseUrl) return;
      setProbing(true);
      setProbeError("");
      try {
        const ids = await fetchModelsForEndpoint(baseUrl, apiKey);
        setModels(ids);
        if (ids.length > 0 && !ids.includes(draft.model)) {
          onChange({ model: ids[0] });
        }
      } catch (e) {
        setProbeError(e instanceof Error ? e.message : String(e));
      } finally {
        setProbing(false);
      }
    },
    [draft.model, onChange],
  );

  // Auto-probe while creating; hosted presets wait for a key.
  const { baseUrl, apiKey } = draft;
  useEffect(() => {
    if (!isCreating || !baseUrl) return;
    if (requiresKey && !apiKey) return;
    const t = setTimeout(() => void probe(baseUrl, apiKey), 500);
    return () => clearTimeout(t);
  }, [isCreating, baseUrl, apiKey, requiresKey, probe]);

  return (
    <div className="space-y-5">
      {preset !== null && onPresetChange && (
        <div className="space-y-1.5">
          <Label htmlFor="p-preset">Provider</Label>
          <Select
            value={preset}
            onValueChange={(next) => {
              if (!next) return;
              onPresetChange(next as PresetId);
              setModels([]);
              setProbeError("");
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
          <p className="text-xs text-muted-foreground">
            Quick-fill for the endpoint below. All providers use the same
            OpenAI-compatible chat API.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="p-base-url">Endpoint</Label>
        <Input
          id="p-base-url"
          placeholder="https://api.openai.com/v1"
          required
          autoFocus={preset === "custom"}
          value={draft.baseUrl}
          onChange={(e) => {
            onChange({ baseUrl: e.target.value });
            setModels([]);
            setProbeError("");
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="p-api-key">
          API key {requiresKey ? null : <OptionalChip />}
        </Label>
        <Input
          id="p-api-key"
          type="password"
          autoComplete="new-password"
          placeholder={requiresKey ? "Required" : "sk-…"}
          required={requiresKey}
          autoFocus={isCreating && requiresKey}
          value={draft.apiKey}
          onChange={(e) => onChange({ apiKey: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="p-model">Model</Label>
          <span className="flex h-5 items-center text-xs text-muted-foreground">
            {probing ? (
              <>
                <Loader2 className="mr-1 size-3 animate-spin" /> Fetching…
              </>
            ) : models.length > 0 ? (
              `${models.length} available`
            ) : probeError ? (
              <button
                type="button"
                onClick={() => probe(draft.baseUrl, draft.apiKey)}
                className="underline-offset-2 hover:underline"
              >
                Retry fetch
              </button>
            ) : requiresKey && !draft.apiKey ? (
              "Add API key to load models"
            ) : null}
          </span>
        </div>
        {models.length > 0 ? (
          <Select
            value={draft.model}
            onValueChange={(value) => {
              if (value == null) return;
              onChange({ model: value });
            }}
          >
            <SelectTrigger id="p-model" className="w-full">
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
            placeholder={presetMeta.modelPlaceholder}
            required
            value={draft.model}
            onChange={(e) => onChange({ model: e.target.value })}
          />
        )}
        {probeError && (
          <p className="text-xs text-destructive">{probeError}</p>
        )}
      </div>
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
