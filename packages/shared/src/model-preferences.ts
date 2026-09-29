export interface ModelPreferences {
  defaultModelId: string | null;
}

/** Keep the current chat's model; otherwise use the default or configured order. */
export function resolveChatModelId(
  models: readonly { id: string }[],
  selectedId: string | null | undefined,
  defaultModelId?: string | null,
): string {
  return (
    [selectedId, defaultModelId].find(
      (id) => id && models.some((model) => model.id === id),
    ) ??
    models[0]?.id ??
    ""
  );
}
