export interface ModelPreferences {
  defaultModelId: string | null;
}

/**
 * Keep the current chat's model; otherwise use the first available default
 * (most specific first, such as project then account) or configured order.
 */
export function resolveChatModelId(
  models: readonly { id: string }[],
  selectedId: string | null | undefined,
  ...defaultModelIds: (string | null | undefined)[]
): string {
  return (
    [selectedId, ...defaultModelIds].find(
      (id) => id && models.some((model) => model.id === id),
    ) ??
    models[0]?.id ??
    ""
  );
}
