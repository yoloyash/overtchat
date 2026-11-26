import { useTranslation } from "react-i18next";
import { SettingsModelIcon } from "@/components/settings/SettingsModelIcon";
import { useState } from "react";
import { Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { ModelCapabilities } from "@overtchat/shared";
import {
  API_FORMATS,
  findProvider,
  isProviderId,
  providerDisplayLabel,
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
  changeModelType,
  customApiFormats,
  modelProviders,
  parseModelDraft,
  providerLabel,
  type ModelDraft,
  type SettingsModelConfig,
} from "@/lib/settings-model";
import { toastSuccess } from "@/lib/toast";
type Discovered = {
  id: string;
  name?: string;
  contextWindow?: number;
  capabilities?: ModelCapabilities;
};
const PRICING_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;
export default function ModelEditor() {
  return (
    <AdminGate>
      <EditorScreen />
    </AdminGate>
  );
}
function EditorScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSettingsQuery<{ modelConfigs: SettingsModelConfig[] }>(
    "/model-configs?admin=1",
    true,
  );
  const model = query.data?.modelConfigs.find((m) => m.id === id);
  return (
    <SettingsPage
      title={
        id === "new"
          ? t("models.page.addModel")
          : (model?.label ?? t("models.connection.modelTitle"))
      }
    >
      {id === "new" || model ? (
        <Editor key={id} model={model} />
      ) : (
        <>
          <QueryState query={query} />
          {query.data && <Label>{t("models.mobile.editor.notFound")}</Label>}
        </>
      )}
    </SettingsPage>
  );
}
function Editor({ model }: { model?: SettingsModelConfig }) {
  const { t } = useTranslation();
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
        title={t("models.mobile.editor.availabilityTitle")}
        description={
          draft.modelType === "image"
            ? t("models.mobile.editor.imageAvailabilityDescription")
            : undefined
        }
      >
        <Toggle
          disabled={busy}
          title={t("models.editor.enabledTitle")}
          value={draft.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
      </Section>
      <Section
        title={t("models.editor.connectionTitle")}
        description={t("models.mobile.editor.connectionDescription")}
      >
        <Choice
          disabled={busy}
          title={t("models.editor.modelTypeSection")}
          value={draft.modelType}
          options={[
            { value: "chat", label: t("models.editor.typeChat") },
            { value: "image", label: t("models.editor.typeImage") },
          ]}
          onChange={(modelType) => {
            const next = changeModelType(draft, modelType);
            if (next.providerId !== draft.providerId) setOptions("");
            setDraft(next);
            setDiscovered([]);
            setResult("");
          }}
        />
        <Choice
          disabled={busy}
          title={t("models.connection.providerTitle")}
          searchLabel={t("models.mobile.editor.searchProvider")}
          value={draft.providerId}
          options={[
            // Keep a provider from a newer server selectable as-is.
            ...(isProviderId(draft.providerId)
              ? []
              : [
                  {
                    value: draft.providerId,
                    label: providerLabel(
                      {
                        providerId: draft.providerId,
                        displayProvider: model?.displayProvider,
                      },
                      t,
                    ),
                    leading: <SettingsModelIcon provider={draft.providerId} />,
                  },
                ]),
            ...modelProviders(draft.modelType).map((id) => ({
              value: id as string,
              label: providerDisplayLabel(id, t),
              leading: <SettingsModelIcon provider={id} />,
            })),
          ]}
          onChange={(id) => {
            if (!isProviderId(id)) return;
            setDraft(changeModelProvider(draft, id));
            setOptions("");
            setDiscovered([]);
            setResult("");
          }}
        />
        {draft.providerId === "custom" && (
          <Choice
            disabled={busy}
            title={t("models.connection.apiFormatTitle")}
            value={draft.apiFormat}
            options={customApiFormats(draft.modelType).map((id) => ({
              value: id,
              label: API_FORMATS[id].label,
            }))}
            onChange={(apiFormat) => connection({ apiFormat })}
          />
        )}
        <Field
          editable={!busy}
          label={t("models.connection.endpointTitle")}
          value={draft.baseUrl}
          onChangeText={(baseUrl) => connection({ baseUrl })}
          keyboardType="url"
          hint={t("models.mobile.editor.endpointHint")}
        />
        <Field
          editable={!busy}
          label={t("models.connection.apiKeyTitle")}
          value={draft.apiKey ?? ""}
          onChangeText={(apiKey) => connection({ apiKey })}
          secureTextEntry
        />
        <Row
          title={t("models.mobile.editor.discoverModels")}
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
                setResult(t("models.mobile.editor.noModelsDiscovered"));
            })
          }
        />
        {discovered.length > 0 && (
          <Choice
            disabled={busy}
            title={t("models.mobile.editor.discoveredModels")}
            searchLabel={t("models.mobile.editor.searchDiscoveredModels")}
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
          label={t("models.mobile.editor.modelIdLabel")}
          value={draft.model}
          onChangeText={(model) =>
            patch({
              model,
              discoveredContextWindow: null,
              discoveredCapabilities: null,
            })
          }
          placeholder={
            // eslint-disable-next-line i18next/no-literal-string -- technical model ID placeholder
            findProvider(draft.providerId)?.modelPlaceholder ?? "model-id"
          }
        />
        <Field
          editable={!busy}
          label={t("models.editor.displayNameTitle")}
          value={draft.label}
          onChangeText={(label) => patch({ label })}
          autoCapitalize="words"
        />
        {draft.modelType === "chat" && (
          <Toggle
            disabled={busy}
            title={t("models.editor.toolCallingTitle")}
            value={draft.toolCallingEnabled}
            onChange={(toolCallingEnabled) => patch({ toolCallingEnabled })}
          />
        )}
      </Section>

      {draft.modelType === "chat" && (
        <Section title={t("models.advanced.title")}>
          <Row
            title={
              advanced
                ? t("models.mobile.editor.hideAdvanced")
                : t("models.mobile.editor.showAdvanced")
            }
            expanded={advanced}
            onPress={() => setAdvanced(!advanced)}
          />
          {advanced && (
            <>
              <Field
                editable={!busy}
                label={t("models.advanced.contextWindowTitle")}
                value={context}
                onChangeText={setContext}
                keyboardType="number-pad"
                hint={
                  model?.resolvedContextWindow
                    ? t("models.mobile.editor.contextWindowHintDetected", {
                        tokens: model.resolvedContextWindow.toLocaleString(),
                      })
                    : t("models.mobile.editor.contextWindowHint")
                }
              />
              <Field
                editable={!busy}
                label={t("models.advanced.systemPromptTitle")}
                value={draft.systemPrompt ?? ""}
                onChangeText={(systemPrompt) =>
                  patch({ systemPrompt: systemPrompt || null })
                }
                multiline
                autoCapitalize="sentences"
              />
              <Field
                editable={!busy}
                label={t("models.mobile.editor.providerOptionsLabel")}
                value={options}
                onChangeText={setOptions}
                multiline
                placeholder="{}"
              />
              <Toggle
                disabled={busy}
                title={t("models.advanced.pricing.customPricingLabel")}
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
                PRICING_KEYS.map((key) => (
                    <Field
                      editable={!busy}
                      key={key}
                      label={t(`models.mobile.editor.pricing.${key}`)}
                      hint={t("models.mobile.editor.pricing.unitHint")}
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
      {draft.modelType === "image" && draft.providerId === "custom" && (
        <Section
          title={t("models.mobile.editor.imageOptionsTitle")}
          description={t("models.mobile.editor.imageOptionsDescription")}
        >
          <Field
            editable={!busy}
            label={t("models.mobile.editor.providerOptionsLabel")}
            value={options}
            onChangeText={setOptions}
            multiline
            // eslint-disable-next-line i18next/no-literal-string -- JSON example placeholder
            placeholder='{ "size": "auto" }'
          />
        </Section>
      )}
      {action.error && <Label error>{action.error}</Label>}
      {result && <Label>{result}</Label>}
      {draft.modelType === "chat" && (
        <Action
          secondary
          title={
            action.busy
              ? t("common.states.working")
              : t("models.connectionTester.testConnection")
          }
          disabled={busy}
          onPress={() =>
            void action.run(async () => {
              const data = await settingsRequest<{ elapsedMs: number }>(
                "/model-configs/ping",
                "POST",
                parseModelDraft(draft, options, context),
              );
              setResult(
                t("models.mobile.editor.connectedInMs", {
                  elapsedMs: data.elapsedMs,
                }),
              );
            })
          }
        />
      )}
      <Action
        title={
          created
            ? t("models.toast.created")
            : busy
              ? t("common.states.saving")
              : t("models.mobile.editor.save")
        }
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
            toastSuccess(
              model ? t("models.toast.saved") : t("models.toast.created"),
            );
          })
        }
      />
      {created && (
        <Action
          secondary
          title={t("models.editor.backLabel")}
          onPress={() => router.back()}
        />
      )}
      {model && (
        <Section title={t("models.mobile.editor.manageTitle")}>
          <Row
            title={t("models.mobile.editor.deleteAction")}
            icon="trash-outline"
            destructive
            disabled={busy || changed}
            onPress={() =>
              Alert.alert(
                t("models.deleteDialog.title"),
                t("models.mobile.editor.deleteMessage", { label: model.label }),
                [
                  { text: t("common.actions.cancel"), style: "cancel" },
                  {
                    text: t("common.actions.delete"),
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
