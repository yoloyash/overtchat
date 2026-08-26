"use client";

import { useState } from "react";
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
  useUpdateServerCapability,
} from "@/lib/queries/serverCapabilities";
import {
  SettingsActions,
  SettingsNotice,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../_components/SettingsRows";

type ProviderOption = {
  value: string;
  label: string;
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
    { value: "bundled", label: "Bundled SearXNG", bundled: true },
    { value: "brave", label: "Brave Search API" },
    { value: "searxng", label: "Existing SearXNG" },
    { value: "disabled", label: "Disabled" },
  ],
  tts: [
    { value: "bundled", label: "Bundled Kokoro", bundled: true },
    { value: "openai-compatible", label: "OpenAI-compatible API" },
    { value: "disabled", label: "Disabled" },
  ],
  stt: [
    { value: "bundled", label: "Bundled Parakeet", bundled: true },
    { value: "openai-compatible", label: "OpenAI-compatible API" },
    { value: "disabled", label: "Disabled" },
  ],
};

const TITLES: Record<AdminServerCapability["id"], string> = {
  search: "Web search",
  tts: "Text-to-speech",
  stt: "Speech-to-text",
};

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
  const [draft, setDraft] = useState<CapabilityDraft>(capability);
  const updateCapability = useUpdateServerCapability();

  async function save() {
    try {
      const updated = await updateCapability.mutateAsync(
        draft as unknown as ServerCapabilityInput,
      );
      setDraft(updated);
      toast.success({ title: `${TITLES[draft.id]} updated` });
    } catch (error) {
      toast.error({
        title: `Could not update ${TITLES[draft.id].toLowerCase()}`,
        description: getErrorMessage(error, "The provider was not changed."),
      });
    }
  }

  const bundledMissing = !draft.bundledInstalled;
  return (
    <SettingsSection
      title={TITLES[draft.id]}
      description={
        draft.id === "search"
          ? "Choose the first provider OvertChat tries."
          : "Choose the provider used by everyone on this server."
      }
    >
      <SettingsRow
        title="Provider"
        description={
          bundledMissing
            ? `${PROVIDERS[draft.id].find((provider) => provider.bundled)?.label} is not installed on this server. Run: overtchat setup`
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
                      : current.model ?? "tts-1",
                  voice:
                    current.provider !== "openai-compatible"
                      ? "alloy"
                      : current.voice ?? "alloy",
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
                      : current.model ?? "whisper-1",
                };
              }
              return { ...current, provider };
            });
          }}
        >
          <SelectTrigger className="w-full" aria-label={`${TITLES[draft.id]} provider`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS[draft.id].map((provider) => (
              <SelectItem
                key={provider.value}
                value={provider.value}
                disabled={provider.bundled && bundledMissing}
              >
                {provider.label}
                {provider.bundled && bundledMissing ? " — Not installed" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {needsBaseUrl(draft) && (
        <SettingsRow title="API base URL" htmlFor={`${draft.id}-base-url`}>
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
                ? "http://host.docker.internal:8088"
                : "https://api.openai.com/v1"
            }
          />
        </SettingsRow>
      )}

      {needsApiKey(draft) && (
        <SettingsRow
          title="API key"
          description={
            draft.apiKeySet
              ? "A key is configured. Leave this blank to keep it."
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
          title="Search order"
          description="If your primary provider fails, OvertChat tries free search providers."
          align="center"
          controlAlign="end"
        >
          <span className="text-xs text-muted-foreground">
            {draft.provider === "brave"
              ? draft.bundledInstalled || draft.baseUrl
                ? "Brave → SearXNG → Firecrawl → Exa → DuckDuckGo"
                : "Brave → Firecrawl → Exa → DuckDuckGo"
              : "SearXNG → Firecrawl → Exa → DuckDuckGo"}
          </span>
        </SettingsRow>
      )}

      {(draft.id === "tts" || draft.id === "stt") &&
        draft.provider === "openai-compatible" && (
          <SettingsRow title="Model" htmlFor={`${draft.id}-model`}>
            <Input
              id={`${draft.id}-model`}
              value={draft.model ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
              placeholder={draft.id === "tts" ? "tts-1" : "whisper-1"}
            />
          </SettingsRow>
        )}

      {draft.id === "tts" && draft.provider === "openai-compatible" && (
        <SettingsRow title="Default voice" htmlFor="tts-voice">
          <Input
            id="tts-voice"
            value={draft.voice ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                voice: event.target.value,
              }))
            }
            placeholder="alloy"
          />
        </SettingsRow>
      )}

      <SettingsActions className="py-4">
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={updateCapability.isPending}
        >
          {updateCapability.isPending ? "Saving…" : "Save"}
        </Button>
      </SettingsActions>
    </SettingsSection>
  );
}

export function ServicesPanel() {
  const { data: capabilities = [], isPending, error } =
    useServerCapabilities();

  return (
    <div className="max-w-3xl space-y-8">
      <SettingsPageHeader
        title="Services"
        description="Manage search and speech providers for this server. Local services are installed with overtchat setup."
      />
      {isPending && <SettingsNotice>Loading services…</SettingsNotice>}
      {error && (
        <SettingsNotice tone="error">
          {getErrorMessage(error, "Could not load server services.")}
        </SettingsNotice>
      )}
      {capabilities.map((capability) => (
        <CapabilitySection key={capability.id} capability={capability} />
      ))}
    </div>
  );
}
