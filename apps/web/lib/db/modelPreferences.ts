import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modelConfigs, userModelPreferences } from "@/lib/db/schema";
import type { ModelPreferences } from "@overtchat/shared";

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Whether `id` names an enabled chat model that a default may point to. */
export function isSelectableChatModel(tx: Db, id: string): boolean {
  return Boolean(
    tx
      .select({ id: modelConfigs.id })
      .from(modelConfigs)
      .where(
        and(
          eq(modelConfigs.id, id),
          eq(modelConfigs.enabled, true),
          eq(modelConfigs.modelType, "chat"),
        ),
      )
      .get(),
  );
}

export function getModelPreferences(userId: string): ModelPreferences {
  return (
    db
      .select({ defaultModelId: userModelPreferences.defaultModelId })
      .from(userModelPreferences)
      .where(eq(userModelPreferences.userId, userId))
      .get() ?? { defaultModelId: null }
  );
}

export function setDefaultModel(
  userId: string,
  defaultModelId: string | null,
): ModelPreferences | null {
  return db.transaction((tx) => {
    if (defaultModelId && !isSelectableChatModel(tx, defaultModelId)) {
      return null;
    }
    tx.insert(userModelPreferences)
      .values({ userId, defaultModelId })
      .onConflictDoUpdate({
        target: userModelPreferences.userId,
        set: { defaultModelId },
      })
      .run();
    return { defaultModelId };
  });
}
