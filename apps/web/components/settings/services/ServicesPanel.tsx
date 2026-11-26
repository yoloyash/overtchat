"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@overtchat/shared/i18n";
import type { VoiceCapability } from "@overtchat/shared";
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
import { toast } from "@/components/ui/toast";
import type {
  AdminServerCapability,
  ServerCapabilityInput,
} from "@/lib/capabilities/schema";
import { getErrorMessage } from "@/lib/errors";
import {
  useServerCapabilities,
  useTestServerCapability,
  useUpdateServerCapability,
} from "@/lib/queries/serverCapabilities";
import {
  SettingsActions,
  SettingsNotice,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../SettingsRows";

type SearchProviderValue = "bundled" | "brave" | "searxng" | "disabled";
type SpeechProviderValue = "bundled" | "openai-compatible" | "disabled";

type ProviderOption<V extends string = string> = {
  value: V;
  bundled?: boolean;
};

type CapabilityDraft = {
  id: AdminServerCapability["id"];
  provider: string;
  bundledInstalled: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  apiKeySet: boolean;
  model: string | null;
  voice: string | null;
  configured: boolean;
};

const PROVIDERS: Record<AdminServerCapability["id"], ProviderOption[]> = {
  search: [
    { value: "bundled", bundled: true },
    { value: "brave" },
    { value: "searxng" },
    { value: "disabled" },
  ] satisfies ProviderOption<SearchProviderValue>[],
  tts: [
    { value: "bundled", bundled: true },
    { value: "openai-compatible" },
    { value: "disabled" },
  ] satisfies ProviderOption<SpeechProviderValue>[],
  stt: [
    { value: "bundled", bundled: true },
    { value: "openai-compatible" },
    { value: "disabled" },
  ] satisfies ProviderOption<SpeechProviderValue>[],
};

function providerOptionLabel(
  capabilityId: AdminServerCapability["id"],
  providerValue: string,
): string {
  switch (capabilityId) {
    case "search":
      if (
        providerValue === "bundled" ||
        providerValue === "brave" ||
        providerValue === "searxng" ||
        providerValue === "disabled"
      ) {
        return i18n.t(`services.capabilities.search.providers.${providerValue}`);
      }
      return providerValue;
    case "tts":
      if (
        providerValue === "bundled" ||
        providerValue === "openai-compatible" ||
        providerValue === "disabled"
      ) {
        return i18n.t(`services.capabilities.tts.providers.${providerValue}`);
      }
      return providerValue;
    case "stt":
      if (
        providerValue === "bundled" ||
        providerValue === "openai-compatible" ||
        providerValue === "disabled"
      ) {
        return i18n.t(`services.capabilities.stt.providers.${providerValue}`);
      }
      return providerValue;
  }
}

interface VoiceServicePresentation {
  label: string;
  description: string;
  configured: boolean;
}

export function voiceServicePresentation(
  voice: VoiceCapability,
): VoiceServicePresentation {
  if (voice.available) {
    return {
      label: i18n.t("services.voice.configuredLabel"),
      description: i18n.t("services.voice.configuredDescription"),
      configured: true,
    };
  }
  switch (voice.unavailableReason) {
    case "not-installed":
      return {
        label: i18n.t("services.voice.notInstalledLabel"),
        description: i18n.t("services.voice.notInstalledDescription"),
        configured: false,
      };
    case "stt-unavailable":
      return {
        label: i18n.t("services.voice.needsSttLabel"),
        description: i18n.t("services.voice.needsSttDescription"),
        configured: false,
      };
    case "tts-unavailable":
      return {
        label: i18n.t("services.voice.needsTtsLabel"),
        description: i18n.t("services.voice.needsTtsDescription"),
        configured: false,
      };
    case "not-configured":
    default:
      return {
        label: i18n.t("services.voice.incompleteSetupLabel"),
        description: i18n.t("services.voice.incompleteSetupDescription"),
        configured: false,
      };
  }
}

function needsBaseUrl(capability: CapabilityDraft): boolean {
  return (
    capability.provider === "searxng" ||
    capability.provider === "openai-compatible"
  );
}

function needsApiKey(capability: CapabilityDraft): boolean {
  return (
    capability.provider === "brave" ||
    capability.provider === "openai-compatible"
  );
}

function CapabilitySection({
  capability,
}: {
  capability: AdminServerCapability;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CapabilityDraft>(capability);
  const updateCapability = useUpdateServerCapability();
  const testCapability = useTestServerCapability();
  const canTest =
    draft.provider === "bundled"
      ? draft.bundledInstalled
      : Boolean(
          draft.baseUrl?.trim() &&
            draft.model?.trim() &&
            (draft.id !== "tts" || draft.voice?.trim()),
        );
  // Results belong to the submitted draft, even if it changes during a request.
  const showTestResult = testCapability.variables === draft;

  async function save() {
    try {
      const { capability: updated } = await updateCapability.mutateAsync(
        draft as unknown as ServerCapabilityInput,
      );
      setDraft(updated);
      toast.success({ title: t(`services.capabilities.${draft.id}.updatedTitle`) });
    } catch (error) {
      toast.error({
        title: t(`services.capabilities.${draft.id}.updateErrorTitle`),
        description: getErrorMessage(error, t("services.errors.updateUnchanged")),
      });
    }
  }

  const bundledMissing = !draft.bundledInstalled;
  const bundledProvider = PROVIDERS[draft.id].find((provider) => provider.bundled);
  const bundledProviderLabel = bundledProvider
    ? providerOptionLabel(draft.id, bundledProvider.value)
    : "";
  return (
    <SettingsSection
      title={t(`services.capabilities.${draft.id}.title`)}
      description={t(`services.capabilities.${draft.id}.description`)}
    >
      <SettingsRow
        title={t("services.fields.providerTitle")}
        description={
          bundledMissing
            ? t("services.fields.bundledMissingDescription", {
                provider: bundledProviderLabel,
              })
            : undefined
        }
        align="center"
      >
        <Select
          value={draft.provider}
          onValueChange={(provider) => {
            if (!provider) return;
            setDraft((current) => {
              if (current.id === "tts" && provider === "bundled") {
                return {
                  ...current,
                  provider,
                  model: "kokoro",
                  voice: "af_heart",
                };
              }
              if (current.id === "tts" && provider === "openai-compatible") {
                return {
                  ...current,
                  provider,
                  model:
                    current.provider !== "openai-compatible"
                      ? "tts-1"
                      : (current.model ?? "tts-1"),
                  voice:
                    current.provider !== "openai-compatible"
                      ? "alloy"
                      : (current.voice ?? "alloy"),
                };
              }
              if (current.id === "stt" && provider === "bundled") {
                return {
                  ...current,
                  provider,
                  model: "parakeet-tdt-0.6b-v3",
                };
              }
              if (current.id === "stt" && provider === "openai-compatible") {
                return {
                  ...current,
                  provider,
                  model:
                    current.provider !== "openai-compatible"
                      ? "whisper-1"
                      : (current.model ?? "whisper-1"),
                };
              }
              return { ...current, provider };
            });
          }}
        >
          <SelectTrigger
            className="w-full"
            aria-label={t(`services.capabilities.${draft.id}.providerLabel`)}
          >
            <SelectValue>
              {PROVIDERS[draft.id].some(
                (provider) => provider.value === draft.provider,
              )
                ? providerOptionLabel(draft.id, draft.provider)
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS[draft.id].map((provider) => (
              <SelectItem
                key={provider.value}
                value={provider.value}
                disabled={provider.bundled && bundledMissing}
              >
                {provider.bundled && bundledMissing
                  ? t("services.fields.providerOptionNotInstalled", {
                      provider: providerOptionLabel(draft.id, provider.value),
                    })
                  : providerOptionLabel(draft.id, provider.value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {needsBaseUrl(draft) && (
        <SettingsRow
          title={t("services.fields.apiBaseUrlTitle")}
          htmlFor={`${draft.id}-base-url`}
        >
          <Input
            id={`${draft.id}-base-url`}
            value={draft.baseUrl ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                baseUrl: event.target.value,
              }))
            }
            placeholder={
              draft.id === "search"
                ? // eslint-disable-next-line i18next/no-literal-string -- example URL placeholder
                  "http://host.docker.internal:8088"
                : // eslint-disable-next-line i18next/no-literal-string -- example URL placeholder
                  "https://api.openai.com/v1"
            }
          />
        </SettingsRow>
      )}

      {needsApiKey(draft) && (
        <SettingsRow
          title={t("services.fields.apiKeyTitle")}
          description={
            draft.apiKeySet
              ? t("services.fields.apiKeyConfiguredDescription")
              : undefined
          }
          htmlFor={`${draft.id}-api-key`}
        >
          <PasswordInput
            id={`${draft.id}-api-key`}
            value={draft.apiKey ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                apiKey: event.target.value,
              }))
            }
            autoComplete="off"
          />
        </SettingsRow>
      )}

      {draft.id === "search" && draft.provider !== "disabled" && (
        <SettingsRow
          title={t("services.fields.searchOrderTitle")}
          description={t("services.fields.searchOrderDescription")}
          align="center"
          controlAlign="end"
        >
          <span className="text-xs text-muted-foreground">
            {draft.provider === "brave"
              ? draft.bundledInstalled || draft.baseUrl
                ? // eslint-disable-next-line i18next/no-literal-string -- search provider brand names
                  "Brave → SearXNG → Firecrawl → Exa → DuckDuckGo"
                : // eslint-disable-next-line i18next/no-literal-string -- search provider brand names
                  "Brave → Firecrawl → Exa → DuckDuckGo"
              : // eslint-disable-next-line i18next/no-literal-string -- search provider brand names
                "SearXNG → Firecrawl → Exa → DuckDuckGo"}
          </span>
        </SettingsRow>
      )}

      {(draft.id === "tts" || draft.id === "stt") &&
        draft.provider === "openai-compatible" && (
          <SettingsRow
            title={t("services.fields.modelTitle")}
            htmlFor={`${draft.id}-model`}
          >
            <Input
              id={`${draft.id}-model`}
              value={draft.model ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
              placeholder={
                draft.id === "tts"
                  ? // eslint-disable-next-line i18next/no-literal-string -- default model ID placeholder
                    "tts-1"
                  : // eslint-disable-next-line i18next/no-literal-string -- default model ID placeholder
                    "whisper-1"
              }
            />
          </SettingsRow>
        )}

      {draft.id === "tts" && draft.provider === "openai-compatible" && (
        <SettingsRow
          title={t("services.fields.defaultVoiceTitle")}
          htmlFor="tts-voice"
        >
          <Input
            id="tts-voice"
            value={draft.voice ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                voice: event.target.value,
              }))
            }
            // eslint-disable-next-line i18next/no-literal-string -- default voice ID placeholder
            placeholder="alloy"
          />
        </SettingsRow>
      )}

      <SettingsActions className="py-4">
        {draft.id !== "search" && draft.provider !== "disabled" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => testCapability.mutate(draft as ServerCapabilityInput)}
            disabled={
              !canTest || testCapability.isPending || updateCapability.isPending
            }
          >
            {testCapability.isPending
              ? t("services.actions.testing")
              : t("services.actions.testConnection")}
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={updateCapability.isPending || testCapability.isPending}
        >
          {updateCapability.isPending
            ? t("services.actions.saving")
            : t("services.actions.save")}
        </Button>
      </SettingsActions>
      {showTestResult && testCapability.isSuccess && (
        <SettingsNotice tone="success" className="py-4">
          {testCapability.data.message}
        </SettingsNotice>
      )}
      {showTestResult && testCapability.isError && (
        <SettingsNotice tone="error" className="py-4">
          {getErrorMessage(
            testCapability.error,
            t("services.errors.connectFailed"),
          )}
        </SettingsNotice>
      )}
    </SettingsSection>
  );
}

export function ServicesPanel() {
  const { t } = useTranslation();
  const { data, isPending, error } = useServerCapabilities();
  const capabilities = data?.capabilities ?? [];
  const voiceStatus = data?.voice ? voiceServicePresentation(data.voice) : null;

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t("services.page.title")}
        description={t("services.page.description")}
      />
      {isPending && (
        <SettingsNotice>{t("services.page.loading")}</SettingsNotice>
      )}
      {error && (
        <SettingsNotice tone="error">
          {getErrorMessage(error, t("services.page.loadError"))}
        </SettingsNotice>
      )}
      {capabilities.map((capability) => (
        <CapabilitySection key={capability.id} capability={capability} />
      ))}
      {voiceStatus && (
        <SettingsSection
          title={t("services.voice.title")}
          description={t("services.voice.description")}
        >
          <SettingsRow
            title={t("services.voice.statusTitle")}
            description={voiceStatus.description}
            align="center"
            controlAlign="end"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <span
                className={
                  voiceStatus.configured
                    ? "size-2 rounded-full bg-emerald-500"
                    : "size-2 rounded-full bg-muted-foreground/40"
                }
                aria-hidden
              />
              {voiceStatus.label}
            </span>
          </SettingsRow>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
