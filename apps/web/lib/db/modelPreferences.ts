import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modelConfigs, userModelFavorites } from "@/lib/db/schema";
import type { ModelPreferences } from "@overtchat/shared";

export function getModelPreferences(userId: string): ModelPreferences {
  return {
    favoriteModelIds: db
      .select({ id: userModelFavorites.modelConfigId })
      .from(userModelFavorites)
      .where(eq(userModelFavorites.userId, userId))
      .orderBy(asc(userModelFavorites.modelConfigId))
      .all()
      .map((row) => row.id),
  };
}

/** Set one favorite idempotently, preserving favorites edited on other devices. */
export function setModelFavorite(
  userId: string,
  modelConfigId: string,
  favorite: boolean,
) {
  return db.transaction((tx) => {
    if (favorite) {
      if (
        !tx
          .select({ id: modelConfigs.id })
          .from(modelConfigs)
          .where(
            and(
              eq(modelConfigs.id, modelConfigId),
              eq(modelConfigs.enabled, true),
              eq(modelConfigs.modelType, "chat"),
            ),
          )
          .get()
      )
        return null;
      tx.insert(userModelFavorites)
        .values({ userId, modelConfigId })
        .onConflictDoNothing()
        .run();
    } else {
      tx.delete(userModelFavorites)
        .where(
          and(
            eq(userModelFavorites.userId, userId),
            eq(userModelFavorites.modelConfigId, modelConfigId),
          ),
        )
        .run();
    }
    return getModelPreferences(userId);
  });
}
