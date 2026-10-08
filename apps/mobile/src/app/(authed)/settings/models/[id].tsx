import { SettingsModelIcon } from "@/components/settings/SettingsModelIcon";
import { useState } from "react";
import { Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { ModelCapabilities } from "@overtchat/shared";
import type { AdminModelConfig } from "@overtchat/shared/admin-settings";
import {
  PROVIDERS,
  PROVIDER_IDS,
  EXPLICIT_API_FORMAT_IDS,
  API_FORMATS,
} from "@overtchat/shared/provider-catalog";
import { AdminGate } from "@/components/settings/AdminGate";
import {
  SettingsPage,
  Section,
  Row,
  Field,
  Choice,
  Toggle,
  Action,
  QueryState,
  Label,
  useAction,
  useUnsavedChanges,
} from "@/components/settings/SettingsUI";
import {
  useSettingsQuery,
  useSettingsMutation,
  settingsRequest,
} from "@/lib/queries/settings";
import {
  modelDraft,
  changeModelProvider,
  parseModelDraft,
  type ModelDraft,
} from "@/lib/settings-model";
import { toastSuccess } from "@/lib/toast";
type Discovered = {
  id: string;
  name?: string;
  contextWindow?: number;
  capabilities?: ModelCapabilities;
};
export default function ModelEditor() {
  return (
    <AdminGate>
      <EditorScreen />
    </AdminGate>
  );
}
function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSettingsQuery<{ modelConfigs: AdminModelConfig[] }>(
    "/model-configs?admin=1",
    true,
  );
  const model = query.data?.modelConfigs.find((m) => m.id === id);
  return (
    <SettingsPage
      title={id === "new" ? "Add model" : (model?.label ?? "Model")}
    >
      {id === "new" || model ? (
        <Editor key={id} model={model} />
      ) : (
        <>
          <QueryState query={query} />
          {query.data && <Label>Model no longer exists.</Label>}
        </>
      )}
    </SettingsPage>
  );
}
function Editor({ model }: { model?: AdminModelConfig }) {
  const [draft, setDraft] = useState(() => modelDraft(model));
  const [pricingText, setPricingText] = useState(() =>
    pricingStrings(model?.pricing),
  );
  const [saved, setSaved] = useState(() => JSON.stringify(modelDraft(model)));
  const [options, setOptions] = useState(() =>
    model?.providerOptions
      ? JSON.stringify(model.providerOptions, null, 2)
      : "",
  );
  const [context, setContext] = useState(String(model?.contextWindow ?? ""));
  const [advanced, setAdvanced] = useState(false);
  const [discovered, setDiscovered] = useState<Discovered[]>([]);
  const [result, setResult] = useState("");
  const [created, setCreated] = useState(false);
  const mutation = useSettingsMutation();
  const action = useAction();
  const busy = action.busy || mutation.isPending || created;
  const changed =
    JSON.stringify(draft) !== saved ||
    options !==
      (draft.providerOptions
        ? JSON.stringify(draft.providerOptions, null, 2)
        : "") ||
    context !== String(draft.contextWindow ?? "");
  useUnsavedChanges(!created && changed);
  function patch(p: Partial<ModelDraft>) {
    setDraft((d) => ({ ...d, ...p }));
    setResult("");
  }
  function connection(p: Partial<ModelDraft>) {
    patch({
      ...p,
      discoveredContextWindow: null,
      discoveredCapabilities: null,
    });
    setDiscovered([]);
  }
  return (
    <>
      <Section
        title="Availability"
        description={
          draft.modelType === "image"
            ? "Enabling this image model disables the other image model."
            : undefined
        }
      >
        <Toggle
          disabled={busy}
          title="Enabled"
          value={draft.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
      </Section>
      <Section
        title="Connection"
        description="Configured models are shared by everyone on this server."
      >
        <Choice
          disabled={busy}
          title="Model type"
          value={draft.modelType}
          options={[
            { value: "chat", label: "Chat" },
            { value: "image", label: "Image" },
          ]}
          onChange={(modelType) => {
            patch({ modelType });
            setDiscovered([]);
          }}
        />
        <Choice
          disabled={busy}
          title="Provider"
          value={draft.providerId}
          options={PROVIDER_IDS.filter(
            (id) =>
              draft.modelType !== "image" || id === "openai" || id === "google",
          ).map((id) => ({
            value: id,
            label: PROVIDERS[id].label,
            leading: <SettingsModelIcon provider={id} />,
          }))}
          onChange={(id) => {
            setDraft(changeModelProvider(draft, id));
            setOptions("");
            setDiscovered([]);
            setResult("");
          }}
        />
        {draft.providerId === "custom" && (
          <Choice
            disabled={busy}
            title="API format"
            value={draft.apiFormat}
            options={EXPLICIT_API_FORMAT_IDS.map((id) => ({
              value: id,
              label: API_FORMATS[id].label,
            }))}
            onChange={(apiFormat) => connection({ apiFormat })}
          />
        )}
        <Field
          editable={!busy}
          label="Endpoint"
          value={draft.baseUrl}
          onChangeText={(baseUrl) => connection({ baseUrl })}
          keyboardType="url"
          hint="Address reachable from your OvertChat server."
        />
        <Field
          editable={!busy}
          label="API key"
          value={draft.apiKey ?? ""}
          onChangeText={(apiKey) => connection({ apiKey })}
          secureTextEntry
        />
        <Row
          title="Discover models"
          icon="search-outline"
          disabled={busy}
          onPress={() =>
            void action.run(async () => {
              const data = await settingsRequest<{ models: Discovered[] }>(
                "/models",
                "POST",
                draft,
              );
              setDiscovered(data.models);
              if (!data.models.length)
                setResult("No models found. Enter a model ID manually.");
            })
          }
        />
        {discovered.length > 0 && (
          <Choice
            disabled={busy}
            title="Discovered models"
            value={draft.model}
            options={discovered.map((m) => ({
              value: m.id,
              label: m.name ?? m.id,
            }))}
            onChange={(id) => {
              const found = discovered.find((m) => m.id === id)!;
              patch({
                model: id,
                discoveredContextWindow: found.contextWindow ?? null,
                discoveredCapabilities: found.capabilities ?? null,
              });
            }}
          />
        )}
        <Field
          editable={!busy}
          label="Model ID"
          value={draft.model}
          onChangeText={(model) =>
            patch({
              model,
              discoveredContextWindow: null,
              discoveredCapabilities: null,
            })
          }
          placeholder={PROVIDERS[draft.providerId].modelPlaceholder}
        />
        <Field
          editable={!busy}
          label="Display name"
          value={draft.label}
          onChangeText={(label) => patch({ label })}
          autoCapitalize="words"
        />
        {draft.modelType === "chat" && (
          <Toggle
            disabled={busy}
            title="Tool calling"
            value={draft.toolCallingEnabled}
            onChange={(toolCallingEnabled) => patch({ toolCallingEnabled })}
          />
        )}
      </Section>

      {draft.modelType === "chat" && (
        <Section title="Advanced">
          <Row
            title={
              advanced ? "Hide advanced settings" : "Show advanced settings"
            }
            expanded={advanced}
            onPress={() => setAdvanced(!advanced)}
          />
          {advanced && (
            <>
              <Field
                editable={!busy}
                label="Context window"
                value={context}
                onChangeText={setContext}
                keyboardType="number-pad"
                hint={`Leave blank for automatic detection${model?.resolvedContextWindow ? ` (${model.resolvedContextWindow.toLocaleString()} tokens)` : ""}.`}
              />
              <Field
                editable={!busy}
                label="System prompt"
                value={draft.systemPrompt ?? ""}
                onChangeText={(systemPrompt) =>
                  patch({ systemPrompt: systemPrompt || null })
                }
                multiline
                autoCapitalize="sentences"
              />
              <Field
                editable={!busy}
                label="Provider options (JSON)"
                value={options}
                onChangeText={setOptions}
                multiline
                placeholder="{}"
              />
              <Toggle
                disabled={busy}
                title="Custom pricing"
                value={draft.pricing !== null}
                onChange={(enabled) => {
                  const pricing = enabled
                    ? (model?.catalogPricing ?? {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                      })
                    : null;
                  setPricingText(pricingStrings(pricing));
                  patch({ pricing });
                }}
              />
              {draft.pricing &&
                (["input", "output", "cacheRead", "cacheWrite"] as const).map(
                  (key) => (
                    <Field
                      editable={!busy}
                      key={key}
                      label={
                        {
                          input: "Input price",
                          output: "Output price",
                          cacheRead: "Cache read price",
                          cacheWrite: "Cache write price",
                        }[key]
                      }
                      hint="USD per 1 million tokens"
                      keyboardType="decimal-pad"
                      value={pricingText[key]}
                      onChangeText={(text) => {
                        setPricingText((current) => ({
                          ...current,
                          [key]: text,
                        }));
                        patch({
                          pricing: {
                            ...draft.pricing!,
                            [key]: text.trim() ? Number(text) : Number.NaN,
                          },
                        });
                      }}
                    />
                  ),
                )}
            </>
          )}
        </Section>
      )}
      {action.error && <Label error>{action.error}</Label>}
      {result && <Label>{result}</Label>}
      {draft.modelType === "chat" && (
        <Action
          secondary
          title={action.busy ? "Working…" : "Test connection"}
          disabled={busy}
          onPress={() =>
            void action.run(async () => {
              const data = await settingsRequest<{ elapsedMs: number }>(
                "/model-configs/ping",
                "POST",
                parseModelDraft(draft, options, context),
              );
              setResult(`Connected in ${data.elapsedMs} ms.`);
            })
          }
        />
      )}
      <Action
        title={created ? "Model created" : busy ? "Saving…" : "Save model"}
        disabled={busy || created}
        onPress={() =>
          void action.run(async () => {
            const input = parseModelDraft(draft, options, context);
            await mutation.mutateAsync({
              path: model ? `/model-configs/${model.id}` : "/model-configs",
              method: model ? "PATCH" : "POST",
              body: input,
            });
            setDraft(input);
            setSaved(JSON.stringify(input));
            setOptions(
              input.providerOptions
                ? JSON.stringify(input.providerOptions, null, 2)
                : "",
            );
            setContext(String(input.contextWindow ?? ""));
            setPricingText(pricingStrings(input.pricing));
            setCreated(!model);
            toastSuccess(model ? "Model saved" : "Model created");
          })
        }
      />
      {created && (
        <Action
          secondary
          title="Back to models"
          onPress={() => router.back()}
        />
      )}
      {model && (
        <Section title="Manage model">
          <Row
            title="Delete model"
            icon="trash-outline"
            destructive
            disabled={busy || changed}
            onPress={() =>
              Alert.alert(
                "Delete model?",
                `${model.label} will no longer be available for new requests. Existing chats remain.`,
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () =>
                      void action.run(async () => {
                        await mutation.mutateAsync({
                          path: `/model-configs/${model.id}`,
                          method: "DELETE",
                        });
                        router.back();
                      }),
                  },
                ],
              )
            }
          />
        </Section>
      )}
    </>
  );
}

function pricingStrings(pricing: ModelDraft["pricing"] | undefined) {
  return {
    input: String(pricing?.input ?? 0),
    output: String(pricing?.output ?? 0),
    cacheRead: String(pricing?.cacheRead ?? 0),
    cacheWrite: String(pricing?.cacheWrite ?? 0),
  };
}
