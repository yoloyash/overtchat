import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { serverCapabilities } from "@/lib/db/schema";
import {
  CAPABILITY_IDS,
  type AdminServerCapability,
  type CapabilityId,
  type ServerCapabilityInput,
} from "@/lib/capabilities/schema";

export type ServerCapabilityRow = typeof serverCapabilities.$inferSelect;

function installedCapabilityDefaults(): Set<string> {
  const configured = process.env.OVERTCHAT_INSTALLED_CAPABILITIES;
  if (configured !== undefined) {
    return new Set(
      configured
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
  }
  // Compatibility with the original Compose stack, where these were bundled.
  return new Set([
    "search",
    "tts",
    ...(process.env.STT_URL ? ["stt"] : []),
  ]);
}

export function isServerCapabilityInstalled(id: string): boolean {
  return installedCapabilityDefaults().has(id);
}

function nullable(value: string | undefined): string | null {
  return value?.trim() || null;
}

function environmentDefault(id: CapabilityId): ServerCapabilityInput {
  const installed = installedCapabilityDefaults();
  if (id === "search") {
    const provider =
      process.env.WEB_SEARCH_PROVIDER ??
      (process.env.SEARXNG_URL &&
      process.env.SEARXNG_URL !== "http://searxng:8080"
        ? "searxng"
        : "bundled");
    return {
      id,
      provider:
        provider === "brave" ||
        provider === "searxng" ||
        provider === "disabled"
          ? provider
          : "bundled",
      bundledInstalled: installed.has("search"),
      baseUrl: nullable(process.env.SEARXNG_URL),
      apiKey: nullable(process.env.BRAVE_SEARCH_API_KEY),
      model: null,
      voice: null,
    };
  }
  if (id === "tts") {
    const provider =
      process.env.TTS_PROVIDER ??
      (process.env.KOKORO_URL &&
      process.env.KOKORO_URL !== "http://kokoro:8880"
        ? "openai-compatible"
        : "bundled");
    return {
      id,
      provider:
        provider === "openai-compatible" || provider === "disabled"
          ? provider
          : "bundled",
      bundledInstalled: installed.has("tts"),
      baseUrl: nullable(process.env.KOKORO_URL),
      apiKey: nullable(process.env.TTS_API_KEY),
      model: nullable(process.env.TTS_MODEL) ?? "kokoro",
      voice: nullable(process.env.TTS_VOICE) ?? "af_heart",
    };
  }
  const provider = process.env.STT_PROVIDER ??
    (process.env.STT_URL && process.env.STT_URL !== "http://stt:5092"
      ? "openai-compatible"
      : process.env.OVERTCHAT_INSTALLED_CAPABILITIES === undefined &&
          process.env.STT_URL
        ? "bundled"
        : "disabled");
  return {
    id,
    provider:
      provider === "bundled" || provider === "openai-compatible"
        ? provider
        : "disabled",
    bundledInstalled: installed.has("stt"),
    baseUrl: nullable(process.env.STT_URL),
    apiKey: nullable(process.env.STT_API_KEY),
    model: nullable(process.env.STT_MODEL) ?? "parakeet-tdt-0.6b-v3",
    voice: null,
  };
}

export function ensureServerCapabilityConfigs(): void {
  db.transaction((tx) => {
    for (const id of CAPABILITY_IDS) {
      const existing = tx
        .select({ id: serverCapabilities.id })
        .from(serverCapabilities)
        .where(eq(serverCapabilities.id, id))
        .get();
      if (existing) continue;
      tx.insert(serverCapabilities).values(environmentDefault(id)).run();
    }
  });
}

export function getServerCapability(
  id: CapabilityId,
): ServerCapabilityRow {
  const row = db
    .select()
    .from(serverCapabilities)
    .where(eq(serverCapabilities.id, id))
    .get();
  if (!row) {
    const fallback = environmentDefault(id);
    db.insert(serverCapabilities).values(fallback).run();
    return db
      .select()
      .from(serverCapabilities)
      .where(eq(serverCapabilities.id, id))
      .get()!;
  }
  return row;
}

export function listServerCapabilities(): ServerCapabilityRow[] {
  ensureServerCapabilityConfigs();
  return CAPABILITY_IDS.map((id) => getServerCapability(id));
}

export function replaceServerCapabilities(
  inputs: ServerCapabilityInput[],
): ServerCapabilityRow[] {
  db.transaction((tx) => {
    for (const input of inputs) {
      tx.insert(serverCapabilities)
        .values(input)
        .onConflictDoUpdate({
          target: serverCapabilities.id,
          set: {
            provider: input.provider,
            bundledInstalled: input.bundledInstalled,
            baseUrl: input.baseUrl,
            apiKey: input.apiKey,
            model: input.model,
            voice: input.voice,
            updatedAt: new Date(),
          },
        })
        .run();
    }
  });
  return listServerCapabilities();
}

export function updateServerCapability(
  input: ServerCapabilityInput,
): ServerCapabilityRow {
  const current = getServerCapability(input.id);
  db.update(serverCapabilities)
    .set({
      provider: input.provider,
      bundledInstalled: current.bundledInstalled,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      voice: input.voice,
      updatedAt: new Date(),
    })
    .where(eq(serverCapabilities.id, input.id))
    .run();
  return getServerCapability(input.id);
}

export function toAdminServerCapability(
  row: ServerCapabilityRow,
): AdminServerCapability {
  return {
    id: row.id,
    provider: row.provider as ServerCapabilityInput["provider"],
    bundledInstalled: row.bundledInstalled,
    baseUrl: row.baseUrl,
    apiKey: null,
    apiKeySet: Boolean(row.apiKey),
    model: row.model,
    voice: row.voice,
    configured: row.provider !== "disabled",
  } as AdminServerCapability;
}
