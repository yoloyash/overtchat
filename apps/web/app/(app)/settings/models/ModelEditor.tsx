"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
  ModelConfigSchema,
  type AdminModelConfig,
  type ModelConfigInput,
} from "@/lib/model-config/schema";
import { getErrorMessage } from "@/lib/errors";
import {
  useAdminModelConfigs,
  useCreateModelConfig,
  useUpdateModelConfig,
} from "@/lib/queries/modelConfigs";
import { getProvider, PROVIDERS } from "@/lib/providers/catalog";
import { AdvancedFields } from "./AdvancedFields";
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

export function ModelEditor({ modelId }: ModelEditorProps) {
  const router = useRouter();
  const { data: list = [] } = useAdminModelConfigs();
  const existing: AdminModelConfig | undefined = modelId
    ? list.find((m) => m.id === modelId)
    : undefined;
  const isEditing = Boolean(modelId);

  const [draft, setDraft] = useState<ModelConfigInput>(() => {
    if (existing) {
      return {
        label: existing.label,
        providerId: existing.providerId,
        apiFormat: existing.apiFormat,
        baseUrl: existing.baseUrl,
        apiKey: existing.apiKey ?? "",
        model: existing.model,
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
      systemPrompt: "",
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

  const createMut = useCreateModelConfig();
  const updateMut = useUpdateModelConfig();
  const saving = createMut.isPending || updateMut.isPending;

  const requiresKey = getProvider(draft.providerId).requiresApiKey;

  const canSave =
    !saving &&
    !!draft.baseUrl &&
    !!draft.model &&
    !providerOptionsError &&
    !(requiresKey && !draft.apiKey);

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

    const parsed = ModelConfigSchema.safeParse({
      ...draft,
      label: draft.label.trim() || defaultLabelFor(draft.model),
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
            onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
            autoFetchModels={!isEditing}
          />

          <SettingsRow
            title="Tool calling"
            description="Allow this model to use tools such as web search. Turn off if the endpoint does not support tool schemas."
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
          systemPrompt={draft.systemPrompt ?? ""}
          onSystemPromptChange={(next) =>
            setDraft((d) => ({ ...d, systemPrompt: next }))
          }
          providerOptionsText={providerOptionsText}
          onProviderOptionsTextChange={(next, err) => {
            setProviderOptionsText(next);
            setProviderOptionsError(err);
          }}
          defaultOpen={Boolean(
            existing?.systemPrompt || existing?.providerOptions,
          )}
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
