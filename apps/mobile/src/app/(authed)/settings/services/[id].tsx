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
import { serviceNames, type ServicesSnapshot } from "./index";
export default function Service() {
  return (
    <AdminGate>
      <ServiceScreen />
    </AdminGate>
  );
}
function ServiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSettingsQuery<ServicesSnapshot>(
    "/server-capabilities",
    true,
  );
  const capability = query.data?.capabilities.find((c) => c.id === id);
  return (
    <SettingsPage title={capability ? serviceNames[capability.id] : "Service"}>
      {capability ? (
        <ServiceForm key={id} capability={capability} />
      ) : (
        <>
          <QueryState query={query} />
          {query.data && <Label>Service not found.</Label>}
        </>
      )}
    </SettingsPage>
  );
}
function ServiceForm({ capability }: { capability: AdminServerCapability }) {
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
          ? "Bundled SearXNG"
          : draft.id === "tts"
            ? "Bundled Kokoro"
            : "Bundled Parakeet",
    },
    ...(draft.id === "search"
      ? [
          { value: "brave", label: "Brave Search API" },
          { value: "searxng", label: "Existing SearXNG" },
        ]
      : [{ value: "openai-compatible", label: "OpenAI-compatible API" }]),
    { value: "disabled", label: "Disabled" },
  ];
  return (
    <>
      <Section
        title="Provider"
        description="Changes affect everyone on this server."
      >
        <Choice
          disabled={action.busy}
          title="Provider"
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
            title="Not installed"
            detail="Run overtchat setup on the server to install this service."
          />
        )}
        {["searxng", "openai-compatible"].includes(draft.provider) && (
          <Field
            editable={!action.busy}
            label="API base URL"
            value={draft.baseUrl ?? ""}
            onChangeText={(baseUrl) => patch({ baseUrl: baseUrl || null })}
            keyboardType="url"
          />
        )}
        {["brave", "openai-compatible"].includes(draft.provider) && (
          <Field
            editable={!action.busy}
            label="API key"
            value={draft.apiKey ?? ""}
            onChangeText={(apiKey) => patch({ apiKey: apiKey || null })}
            secureTextEntry
            hint={
              draft.apiKeySet
                ? "A key is saved. Leave blank to keep it."
                : "Enter your provider key."
            }
          />
        )}
        {draft.provider === "openai-compatible" && (
          <>
            <Field
              editable={!action.busy}
              label="Model"
              value={draft.model ?? ""}
              onChangeText={(model) => patch({ model: model || null })}
            />
            {draft.id === "tts" && (
              <Field
                editable={!action.busy}
                label="Default voice"
                value={draft.voice ?? ""}
                onChangeText={(voice) => patch({ voice: voice || null })}
              />
            )}
          </>
        )}
        {draft.provider === "bundled" && draft.id === "tts" && (
          <Field
            editable={!action.busy}
            label="Default voice"
            value={draft.voice ?? ""}
            onChangeText={(voice) => patch({ voice: voice || null })}
          />
        )}
      </Section>
      {draft.id === "search" && (
        <Label muted>
          When the primary search provider fails, OvertChat tries free search
          providers.
        </Label>
      )}
      {action.error && <Label error>{action.error}</Label>}
      {result && <Label>{result}</Label>}
      {draft.id !== "search" && draft.provider !== "disabled" && (
        <Action
          secondary
          title={action.busy ? "Working…" : "Test connection"}
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
        title={action.busy ? "Saving…" : "Save service"}
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
            toastSuccess("Service saved");
          })
        }
      />
    </>
  );
}
