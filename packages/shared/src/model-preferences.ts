export interface ModelPreferences {
  favoriteModelIds: string[];
}

/** Favorites affect list order, never the current chat's model selection. */
export function resolveChatModelId(
  models: readonly { id: string }[],
  selectedId: string | null | undefined,
  rememberedId?: string | null,
): string {
  return (
    [selectedId, rememberedId].find(
      (id) => id && models.some((model) => model.id === id),
    ) ??
    models[0]?.id ??
    ""
  );
}

export function favoriteModelsFirst<T extends { id: string }>(
  models: readonly T[],
  favoriteModelIds: readonly string[] = [],
): T[] {
  const favorites = new Set(favoriteModelIds);
  return [...models].sort(
    (a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)),
  );
}
