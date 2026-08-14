import { z } from "zod";

export const CAPABILITY_IDS = ["search", "tts", "stt"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export const searchProviderSchema = z.enum([
  "bundled",
  "brave",
  "searxng",
  "disabled",
]);
export const ttsProviderSchema = z.enum([
  "bundled",
  "openai-compatible",
  "disabled",
]);
export const sttProviderSchema = ttsProviderSchema;

const commonFields = {
  bundledInstalled: z.boolean(),
  baseUrl: z.string().url().nullable(),
  apiKey: z.string().nullable(),
  model: z.string().nullable(),
  voice: z.string().nullable(),
};

export const serverCapabilityInputSchema = z.discriminatedUnion("id", [
  z.object({
    id: z.literal("search"),
    provider: searchProviderSchema,
    ...commonFields,
  }),
  z.object({
    id: z.literal("tts"),
    provider: ttsProviderSchema,
    ...commonFields,
  }),
  z.object({
    id: z.literal("stt"),
    provider: sttProviderSchema,
    ...commonFields,
  }),
]);

export const serverCapabilitiesInputSchema = z.object({
  capabilities: z
    .array(serverCapabilityInputSchema)
    .length(CAPABILITY_IDS.length)
    .refine(
      (values) => new Set(values.map((value) => value.id)).size === CAPABILITY_IDS.length,
      "Provide one configuration for each capability.",
    ),
});

export type ServerCapabilityInput = z.infer<
  typeof serverCapabilityInputSchema
>;

export type AdminServerCapability = ServerCapabilityInput & {
  configured: boolean;
  apiKeySet: boolean;
};
