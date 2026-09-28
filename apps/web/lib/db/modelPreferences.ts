import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modelConfigs, userModelPreferences } from "@/lib/db/schema";
import type { ModelPreferences } from "@overtchat/shared";

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
    if (
      defaultModelId &&
      !tx
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.id, defaultModelId),
            eq(modelConfigs.enabled, true),
            eq(modelConfigs.modelType, "chat"),
          ),
        )
        .get()
    ) {
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
