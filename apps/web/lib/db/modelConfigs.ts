import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modelConfigs } from "@/lib/db/schema";
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
    systemPrompt: row.systemPrompt,
    providerOptions: row.providerOptions,
    enabled: row.enabled,
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
