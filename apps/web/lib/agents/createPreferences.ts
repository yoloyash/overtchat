import { z } from "zod";
import type { AgentProviderId } from "@overtchat/agent-bridge";

export type AgentProviderPreferences = {
  model?: string;
  mode?: string;
  thinkingByModel?: Record<string, string>;
};

export type AgentCreatePreferences = {
  providerPreferences?: Partial<
    Record<AgentProviderId, AgentProviderPreferences>
  >;
};

const providerPreferencesSchema = z.strictObject({
  model: z.string().optional(),
  mode: z.string().optional(),
  thinkingByModel: z.record(z.string(), z.string()).optional(),
});

const preferencesSchema = z.strictObject({
  providerPreferences: z
    .partialRecord(
      z.enum(["pi", "omp", "codex", "opencode"]),
      providerPreferencesSchema,
    )
    .optional(),
});

export const AGENT_CREATE_PREFERENCES_KEY =
  "overtchat:agent-create-preferences";
export const DEFAULT_AGENT_CREATE_PREFERENCES: AgentCreatePreferences = {};

export function parseAgentCreatePreferences(
  value: unknown,
): AgentCreatePreferences {
  const parsed = preferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AGENT_CREATE_PREFERENCES;
}

export function mergeAgentProviderPreferences({
  preferences,
  provider,
  updates,
}: {
  preferences: AgentCreatePreferences;
  provider: AgentProviderId;
  updates: Partial<AgentProviderPreferences>;
}): AgentCreatePreferences {
  const existing = preferences.providerPreferences?.[provider] ?? {};
  return {
    ...preferences,
    providerPreferences: {
      ...preferences.providerPreferences,
      [provider]: {
        ...existing,
        ...updates,
        ...(updates.thinkingByModel
          ? {
              thinkingByModel: {
                ...existing.thinkingByModel,
                ...updates.thinkingByModel,
              },
            }
          : {}),
      },
    },
  };
}
