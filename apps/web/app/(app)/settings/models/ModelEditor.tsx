"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ModelConfigSchema,
  type AdminModelConfig,
  type ModelConfigInput,
} from "@/lib/config";
import {
  useAdminModelConfigs,
  useCreateModelConfig,
  useUpdateModelConfig,
} from "@/lib/queries/modelConfigs";
import { PRESETS, presetFor, type PresetId } from "@/lib/providers/meta";
import { AdvancedFields } from "./AdvancedFields";
import { ConnectionFields } from "./ConnectionFields";
import { ConnectionTester } from "./ConnectionTester";
import { SettingsRow, SettingsSection } from "../_components/SettingsRows";

export interface ModelEditorProps {
  /** When provided, editor loads the existing config from cache; otherwise a new one is being created. */
  modelId?: string;
}

export function ModelEditor({ modelId }: ModelEditorProps) {
  const router = useRouter();
  const { data: list = [] } = useAdminModelConfigs();
  const existing: AdminModelConfig | undefined = modelId
    ? list.find((m) => m.id === modelId)
    : undefined;
  const isEditing = Boolean(modelId);

  const [preset, setPreset] = useState<PresetId>(() =>
    existing ? presetFor(existing.baseUrl) : "openai",
  );

  const [draft, setDraft] = useState<ModelConfigInput>(() => {
    if (existing) {
      return {
        label: existing.label,
        baseUrl: existing.baseUrl,
        apiKey: existing.apiKey ?? "",
        model: existing.model,
        systemPrompt: existing.systemPrompt ?? "",
        extraBody: existing.extraBody,
        enabled: existing.enabled,
        sortOrder: existing.sortOrder,
      };
    }
    return {
      label: "",
      baseUrl: PRESETS.openai.defaultBaseUrl,
      apiKey: "",
      model: "",
      systemPrompt: "",
      extraBody: null,
      enabled: true,
      sortOrder: 0,
    };
  });

  const [extraBodyText, setExtraBodyText] = useState(() =>
    existing?.extraBody ? JSON.stringify(existing.extraBody, null, 2) : "",
  );
  const [extraBodyError, setExtraBodyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");

  const createMut = useCreateModelConfig();
  const updateMut = useUpdateModelConfig();
  const saving = createMut.isPending || updateMut.isPending;

  const requiresKey = preset !== "custom";

  const canSave =
    !saving &&
    !!draft.baseUrl &&
    !!draft.model &&
    !extraBodyError &&
    !(requiresKey && !draft.apiKey);

  const pingArgs = useMemo(() => {
    let parsedExtra: Record<string, unknown> | null = null;
    if (extraBodyText.trim() && !extraBodyError) {
      try {
        parsedExtra = JSON.parse(extraBodyText) as Record<string, unknown>;
      } catch {
        parsedExtra = null;
      }
    }
    return {
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey ?? "",
      model: draft.model,
      extraBody: parsedExtra,
    };
  }, [draft.baseUrl, draft.apiKey, draft.model, extraBodyText, extraBodyError]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError("");

    let extraBody: unknown = null;
    if (extraBodyText.trim()) {
      try {
        extraBody = JSON.parse(extraBodyText);
      } catch (err) {
        setSaveError(
          `Extra body must be valid JSON object: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return;
      }
    }

    const parsed = ModelConfigSchema.safeParse({
      ...draft,
      label: draft.label.trim() || defaultLabelFor(draft.model),
      extraBody,
    });
    if (!parsed.success) {
      setSaveError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    const input: ModelConfigInput = parsed.data;

    try {
      if (modelId) {
        await updateMut.mutateAsync({ id: modelId, input });
      } else {
        await createMut.mutateAsync(input);
      }
      router.push("/settings/models");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center gap-2">
        <Button
          render={<Link href="/settings/models" />}
          variant="ghost"
          size="icon-sm"
          aria-label="Back to models"
        >
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {isEditing ? "Edit model" : "Add model"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure a model that everyone on this server can use.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-8">
        <SettingsSection
          title="Connection"
          description="Provider, credentials, model discovery, and connectivity."
        >
          <ConnectionFields
            draft={{
              baseUrl: draft.baseUrl,
              apiKey: draft.apiKey ?? "",
              model: draft.model,
            }}
            onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
            preset={preset}
            autoFetchModels={!isEditing}
            onPresetChange={(next) => {
              setPreset(next);
              setDraft((d) => ({
                ...d,
                baseUrl: PRESETS[next].defaultBaseUrl,
                apiKey: "",
                model: "",
              }));
            }}
          />

          <SettingsRow
            title="Test connection"
            description="Send a short request with the current connection settings."
          >
            <ConnectionTester
              key={`${draft.baseUrl}|${draft.apiKey}|${draft.model}|${extraBodyText}`}
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
          >
            <Input
              id="p-label"
              placeholder={
                draft.model ? defaultLabelFor(draft.model) : "Shown in the picker"
              }
              value={draft.label}
              onChange={(e) =>
                setDraft((d) => ({ ...d, label: e.target.value }))
              }
            />
          </SettingsRow>

          <SettingsRow
            title="Available in chat"
            description="Turn off to keep the config without showing it in the picker."
            align="center"
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
          systemPrompt={draft.systemPrompt ?? ""}
          onSystemPromptChange={(next) =>
            setDraft((d) => ({ ...d, systemPrompt: next }))
          }
          extraBodyText={extraBodyText}
          onExtraBodyTextChange={(next, err) => {
            setExtraBodyText(next);
            setExtraBodyError(err);
          }}
          defaultOpen={Boolean(existing?.systemPrompt || existing?.extraBody)}
        />

        {saveError && (
          <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <XCircle className="size-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{saveError}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t pt-4">
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
        </div>
      </form>
    </div>
  );
}

function defaultLabelFor(model: string): string {
  if (!model) return "";
  return model.split("/").pop() ?? model;
}
