import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modelConfigs } from "@/lib/db/schema";
import {
  catalogPricingFor,
  resolveModelCapabilities,
  resolveModelContextWindow,
} from "@/lib/providers/server/model-catalog";
import type {
  AdminModelConfig,
  ModelConfigInput,
} from "@/lib/model-config/schema";

export type { ModelConfigInput };
export type ModelConfigRow = typeof modelConfigs.$inferSelect;

export function toAdminModelConfig(row: ModelConfigRow): AdminModelConfig {
  return {
    id: row.id,
    label: row.label,
    providerId: row.providerId,
    apiFormat: row.apiFormat,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: row.model,
    pricing: row.pricing,
    catalogPricing: catalogPricingFor(row.providerId, row.model) ?? null,
    contextWindow: row.contextWindow,
    discoveredContextWindow: row.discoveredContextWindow,
    discoveredCapabilities: row.discoveredCapabilities,
    resolvedContextWindow: resolveModelContextWindow(
      row.contextWindow,
      row.discoveredContextWindow,
      row.providerId,
      row.model,
    ),
    resolvedCapabilities: resolveModelCapabilities(
      row.discoveredCapabilities,
      row.providerId,
      row.model,
    ),
    systemPrompt: row.systemPrompt,
    providerOptions: row.providerOptions,
    toolCallingEnabled: row.toolCallingEnabled,
    enabled: row.enabled,
    taskModel: row.taskModel,
    sortOrder: row.sortOrder,
  };
}

export async function listModelConfigs(): Promise<ModelConfigRow[]> {
  return db
    .select()
    .from(modelConfigs)
    .orderBy(asc(modelConfigs.sortOrder), asc(modelConfigs.label));
}

export async function getModelConfig(
  id: string,
): Promise<ModelConfigRow | null> {
  const [row] = await db
    .select()
    .from(modelConfigs)
    .where(eq(modelConfigs.id, id))
    .limit(1);
  return row ?? null;
}

export function getTaskModelConfig(): ModelConfigRow | null {
  return (
    db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.taskModel, true))
      .limit(1)
      .get() ?? null
  );
}

export type SetTaskModelResult =
  | { status: "updated"; modelConfig: ModelConfigRow | null }
  | { status: "not_found" };

export function setTaskModelConfig(
  id: string | null,
): SetTaskModelResult {
  return db.transaction((tx) => {
    const target = id
      ? tx
          .select()
          .from(modelConfigs)
          .where(eq(modelConfigs.id, id))
          .limit(1)
          .get()
      : null;
    if (id && !target) return { status: "not_found" };

    tx.update(modelConfigs)
      .set({ taskModel: false, updatedAt: new Date() })
      .where(eq(modelConfigs.taskModel, true))
      .run();

    if (!target) return { status: "updated", modelConfig: null };

    const updated = tx
      .update(modelConfigs)
      .set({ taskModel: true, updatedAt: new Date() })
      .where(eq(modelConfigs.id, target.id))
      .returning()
      .get();
    return updated
      ? { status: "updated", modelConfig: updated }
      : { status: "not_found" };
  });
}

export async function createModelConfig(
  input: ModelConfigInput,
): Promise<ModelConfigRow> {
  const [row] = await db
    .insert(modelConfigs)
    .values({ id: crypto.randomUUID(), ...input })
    .returning();
  return row;
}

export async function updateModelConfig(
  id: string,
  input: ModelConfigInput,
): Promise<ModelConfigRow | null> {
  const [row] = await db
    .update(modelConfigs)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(modelConfigs.id, id))
    .returning();
  return row ?? null;
}

export async function deleteModelConfig(id: string): Promise<void> {
  await db.delete(modelConfigs).where(eq(modelConfigs.id, id));
}
