import "server-only";
import { and, asc, eq, max } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modelConfigs, modelConfigUserCredentials } from "@/lib/db/schema";
import {
  catalogPricingFor,
  resolveModelCapabilities,
  resolveModelContextWindow,
} from "@/lib/providers/server/model-catalog";
import type {
  AdminModelConfig,
  AdminModelUserCredential,
  ModelConfigInput,
  ModelUserCredentialInput,
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
    credentialScope: row.credentialScope,
    sortOrder: row.sortOrder,
  };
}

export async function listModelConfigs(): Promise<ModelConfigRow[]> {
  return db
    .select()
    .from(modelConfigs)
    .orderBy(asc(modelConfigs.sortOrder), asc(modelConfigs.label));
}

/** Save a complete order atomically, rejecting lists from an outdated catalog. */
export function reorderModelConfigs(modelIds: string[]): boolean {
  return db.transaction((tx) => {
    const current = tx.select({ id: modelConfigs.id }).from(modelConfigs).all();
    const ids = new Set(modelIds);
    if (
      ids.size !== modelIds.length ||
      current.length !== ids.size ||
      current.some((model) => !ids.has(model.id))
    )
      return false;
    modelIds.forEach((id, sortOrder) => {
      tx.update(modelConfigs)
        .set({ sortOrder })
        .where(eq(modelConfigs.id, id))
        .run();
    });
    return true;
  });
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
  | { status: "not_found" }
  | { status: "per_user" };

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
    // Task work (titles) has no single user to bill, so it needs a shared connection.
    if (target?.credentialScope === "user") return { status: "per_user" };

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
      .values({
        id: crypto.randomUUID(),
        ...input,
        sortOrder:
          (tx
            .select({ last: max(modelConfigs.sortOrder) })
            .from(modelConfigs)
            .get()?.last ?? -1) + 1,
      })
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
          ...(input.modelType === "image" || input.credentialScope === "user"
            ? { taskModel: false }
            : {}),
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

// --- per-user credentials --------------------------------------------------

/**
 * The connection `userId` must use for `row`: the row itself for a shared
 * model, or the row with that user's key (and base URL, when set) for a
 * per-user model. `null` when the model is per-user and the user has no
 * credential, so callers treat it as unavailable rather than falling back to
 * the model's own key.
 */
export function modelConfigForUser<T extends ModelConfigRow>(
  row: T,
  userId: string,
): T | null {
  if (row.credentialScope !== "user") return row;
  const credential = getModelUserCredential(row.id, userId);
  if (!credential) return null;
  return {
    ...row,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? row.baseUrl,
  };
}

export function getModelUserCredential(modelConfigId: string, userId: string) {
  return (
    db
      .select()
      .from(modelConfigUserCredentials)
      .where(
        and(
          eq(modelConfigUserCredentials.modelConfigId, modelConfigId),
          eq(modelConfigUserCredentials.userId, userId),
        ),
      )
      .get() ?? null
  );
}

/** Ids of the per-user models `userId` has a credential for. */
export function listCredentialedModelIds(userId: string): Set<string> {
  return new Set(
    db
      .select({ id: modelConfigUserCredentials.modelConfigId })
      .from(modelConfigUserCredentials)
      .where(eq(modelConfigUserCredentials.userId, userId))
      .all()
      .map((row) => row.id),
  );
}

/** Whether `userId` may chat with `row`. */
export function isModelAvailableToUser(
  row: Pick<ModelConfigRow, "id" | "credentialScope">,
  credentialed: Set<string>,
): boolean {
  return row.credentialScope !== "user" || credentialed.has(row.id);
}

export function listModelUserCredentials(
  modelConfigId: string,
): AdminModelUserCredential[] {
  return db
    .select()
    .from(modelConfigUserCredentials)
    .where(eq(modelConfigUserCredentials.modelConfigId, modelConfigId))
    .all()
    .map((row) => ({
      userId: row.userId,
      hasApiKey: !!row.apiKey,
      baseUrl: row.baseUrl,
      updatedAt: row.updatedAt.getTime(),
    }));
}

export function setModelUserCredential(
  modelConfigId: string,
  userId: string,
  input: ModelUserCredentialInput,
): AdminModelUserCredential {
  const now = new Date();
  const row = db
    .insert(modelConfigUserCredentials)
    .values({ modelConfigId, userId, ...input, apiKey: input.apiKey ?? null })
    .onConflictDoUpdate({
      target: [
        modelConfigUserCredentials.modelConfigId,
        modelConfigUserCredentials.userId,
      ],
      set: { ...input, updatedAt: now },
    })
    .returning()
    .get();
  return {
    userId: row.userId,
    hasApiKey: !!row.apiKey,
    baseUrl: row.baseUrl,
    updatedAt: row.updatedAt.getTime(),
  };
}

export function deleteModelUserCredential(
  modelConfigId: string,
  userId: string,
): boolean {
  return (
    db
      .delete(modelConfigUserCredentials)
      .where(
        and(
          eq(modelConfigUserCredentials.modelConfigId, modelConfigId),
          eq(modelConfigUserCredentials.userId, userId),
        ),
      )
      .run().changes > 0
  );
}
