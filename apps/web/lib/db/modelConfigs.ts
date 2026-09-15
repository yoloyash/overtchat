import "server-only";
import { and, asc, eq } from "drizzle-orm";
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
    modelType: row.modelType,
    label: row.label,
    providerId: row.providerId,
    apiFormat: row.apiFormat,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    updatedAt: row.updatedAt.getTime(),
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
      .where(
        and(
          eq(modelConfigs.taskModel, true),
          eq(modelConfigs.modelType, "chat"),
        ),
      )
      .limit(1)
      .get() ?? null
  );
}

export type SetTaskModelResult =
  | { status: "updated"; modelConfig: ModelConfigRow | null }
  | { status: "not_found" };

export function setTaskModelConfig(id: string | null): SetTaskModelResult {
  return db.transaction((tx) => {
    const target = id
      ? tx
          .select()
          .from(modelConfigs)
          .where(eq(modelConfigs.id, id))
          .limit(1)
          .get()
      : null;
    if (id && (!target || target.modelType === "image"))
      return { status: "not_found" };

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
  return db.transaction((tx) => {
    if (input.modelType === "image" && input.enabled) {
      tx.update(modelConfigs)
        .set({ enabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(modelConfigs.modelType, "image"),
            eq(modelConfigs.enabled, true),
          ),
        )
        .run();
    }
    return tx
      .insert(modelConfigs)
      .values({ id: crypto.randomUUID(), ...input })
      .returning()
      .get();
  });
}

export async function updateModelConfig(
  id: string,
  input: ModelConfigInput,
): Promise<ModelConfigRow | null> {
  return db.transaction((tx) => {
    if (
      !tx
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(eq(modelConfigs.id, id))
        .get()
    )
      return null;
    if (input.modelType === "image" && input.enabled) {
      tx.update(modelConfigs)
        .set({ enabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(modelConfigs.modelType, "image"),
            eq(modelConfigs.enabled, true),
          ),
        )
        .run();
    }
    return (
      tx
        .update(modelConfigs)
        .set({
          ...input,
          ...(input.modelType === "image" ? { taskModel: false } : {}),
          updatedAt: new Date(),
        })
        .where(eq(modelConfigs.id, id))
        .returning()
        .get() ?? null
    );
  });
}

export function getImageModelConfig(): ModelConfigRow | null {
  return (
    db
      .select()
      .from(modelConfigs)
      .where(
        and(
          eq(modelConfigs.modelType, "image"),
          eq(modelConfigs.enabled, true),
        ),
      )
      .limit(1)
      .get() ?? null
  );
}

export async function deleteModelConfig(id: string): Promise<void> {
  await db.delete(modelConfigs).where(eq(modelConfigs.id, id));
}
