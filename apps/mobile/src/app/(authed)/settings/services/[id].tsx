import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import type { AdminServerCapability } from "@overtchat/shared/admin-settings";
import { AdminGate } from "@/components/settings/AdminGate";
import {
  SettingsPage,
  Section,
  Row,
  Field,
  Choice,
  Action,
  Label,
  QueryState,
  useAction,
  useUnsavedChanges,
} from "@/components/settings/SettingsUI";
import {
  useSettingsQuery,
  useSettingsMutation,
  settingsRequest,
} from "@/lib/queries/settings";
import { toastSuccess } from "@/lib/toast";
import { serviceNameKeys, type ServicesSnapshot } from "./index";
export default function Service() {
  return (
    <AdminGate>
      <ServiceScreen />
    </AdminGate>
  );
}
function ServiceScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSettingsQuery<ServicesSnapshot>(
    "/server-capabilities",
    true,
  );
  const capability = query.data?.capabilities.find((c) => c.id === id);
  return (
    <SettingsPage
      title={
        capability
          ? t(serviceNameKeys[capability.id])
          : t("services.mobile.detail.fallbackTitle")
      }
    >
      {capability ? (
        <ServiceForm key={id} capability={capability} />
      ) : (
        <>
          <QueryState query={query} />
          {query.data && <Label>{t("services.mobile.detail.notFound")}</Label>}
        </>
      )}
    </SettingsPage>
  );
}
function ServiceForm({ capability }: { capability: AdminServerCapability }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(capability);
  const [saved, setSaved] = useState(JSON.stringify(capability));
  const [result, setResult] = useState("");
  const action = useAction();
  const mutation = useSettingsMutation<{ capability: AdminServerCapability }>();
  const dirty = JSON.stringify(draft) !== saved;
  useUnsavedChanges(dirty);
  function patch(p: Partial<AdminServerCapability>) {
    setDraft((d) => ({ ...d, ...p }));
    setResult("");
  }
  const providers = [
    {
      value: "bundled",
      label:
        draft.id === "search"
          ? t("services.capabilities.search.providers.bundled")
          : draft.id === "tts"
            ? t("services.capabilities.tts.providers.bundled")
            : t("services.capabilities.stt.providers.bundled"),
    },
    ...(draft.id === "search"
      ? [
          {
            value: "brave",
            label: t("services.capabilities.search.providers.brave"),
          },
          {
            value: "searxng",
            label: t("services.capabilities.search.providers.searxng"),
          },
        ]
      : [
          {
            value: "openai-compatible",
            label: t("services.capabilities.tts.providers.openai-compatible"),
          },
        ]),
    {
      value: "disabled",
      label: t("services.mobile.status.disabled"),
    },
  ];
  return (
    <>
      <Section
        title={t("services.fields.providerTitle")}
        description={t("services.mobile.detail.providerDescription")}
      >
        <Choice
          disabled={action.busy}
          title={t("services.fields.providerTitle")}
          value={draft.provider}
          options={providers}
          onChange={(provider) => {
            const changed = provider !== draft.provider;
            patch({
              provider,
              ...(changed ? { apiKey: null } : {}),
              ...(provider === "bundled" && draft.id === "tts"
                ? { model: "kokoro", voice: "af_heart" }
                : {}),
              ...(provider === "bundled" && draft.id === "stt"
                ? { model: "parakeet" }
                : {}),
              ...(provider === "openai-compatible" && changed
                ? {
                    baseUrl: "https://api.openai.com/v1",
                    model: draft.id === "tts" ? "tts-1" : "whisper-1",
                    voice: draft.id === "tts" ? "alloy" : null,
                  }
                : {}),
            });
          }}
        />
        {draft.provider === "bundled" && !draft.bundledInstalled && (
          <Row
            title={t("services.voice.notInstalledLabel")}
            detail={t("services.mobile.detail.notInstalledDetail")}
          />
        )}
        {["searxng", "openai-compatible"].includes(draft.provider) && (
          <Field
            editable={!action.busy}
            label={t("services.fields.apiBaseUrlTitle")}
            value={draft.baseUrl ?? ""}
            onChangeText={(baseUrl) => patch({ baseUrl: baseUrl || null })}
            keyboardType="url"
          />
        )}
        {["brave", "openai-compatible"].includes(draft.provider) && (
          <Field
            editable={!action.busy}
            label={t("services.fields.apiKeyTitle")}
            value={draft.apiKey ?? ""}
            onChangeText={(apiKey) => patch({ apiKey: apiKey || null })}
            secureTextEntry
            hint={
              draft.apiKeySet
                ? t("services.mobile.detail.apiKeySavedHint")
                : t("services.mobile.detail.apiKeyEmptyHint")
            }
          />
        )}
        {draft.provider === "openai-compatible" && (
          <>
            <Field
              editable={!action.busy}
              label={t("services.fields.modelTitle")}
              value={draft.model ?? ""}
              onChangeText={(model) => patch({ model: model || null })}
            />
            {draft.id === "tts" && (
              <Field
                editable={!action.busy}
                label={t("services.fields.defaultVoiceTitle")}
                value={draft.voice ?? ""}
                onChangeText={(voice) => patch({ voice: voice || null })}
              />
            )}
          </>
        )}
        {draft.provider === "bundled" && draft.id === "tts" && (
          <Field
            editable={!action.busy}
            label={t("services.fields.defaultVoiceTitle")}
            value={draft.voice ?? ""}
            onChangeText={(voice) => patch({ voice: voice || null })}
          />
        )}
      </Section>
      {draft.id === "search" && (
        <Label muted>{t("services.mobile.detail.searchFallbackNote")}</Label>
      )}
      {action.error && <Label error>{action.error}</Label>}
      {result && <Label>{result}</Label>}
      {draft.id !== "search" && draft.provider !== "disabled" && (
        <Action
          secondary
          title={
            action.busy
              ? t("common.states.working")
              : t("services.actions.testConnection")
          }
          disabled={action.busy}
          onPress={() =>
            void action.run(async () => {
              const data = await settingsRequest<{ message: string }>(
                `/server-capabilities/${draft.id}/test`,
                "POST",
                draft,
              );
              setResult(data.message);
            })
          }
        />
      )}
      <Action
        title={
          action.busy
            ? t("common.states.saving")
            : t("services.mobile.detail.save")
        }
        disabled={action.busy || !dirty}
        onPress={() =>
          void action.run(async () => {
            const data = await mutation.mutateAsync({
              path: `/server-capabilities/${draft.id}`,
              method: "PUT",
              body: draft,
            });
            setDraft(data.capability);
            setSaved(JSON.stringify(data.capability));
            toastSuccess(t("services.mobile.detail.saved"));
          })
        }
      />
    </>
  );
}
