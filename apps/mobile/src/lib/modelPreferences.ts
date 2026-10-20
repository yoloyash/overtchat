import { useState } from "react";
import { resolveChatModelId } from "@overtchat/shared";
import { useModelPreferences } from "@/lib/queries/modelPreferences";

export function useSelectedModel(
  models: readonly { id: string }[] | undefined,
  initialModelId?: string | null,
): [string, (id: string) => void] {
  const preferences = useModelPreferences();
  const [selection, setSelection] = useState<string | null>(
    initialModelId ?? null,
  );
  // Wait for this mount's default refresh before initializing a new chat.
  const waiting =
    !models?.some((model) => model.id === selection) &&
    (preferences.isPending || preferences.isFetching);
  const selectedId = waiting
    ? ""
    : resolveChatModelId(
        models ?? [],
        selection,
        preferences.data?.defaultModelId,
      );
  if (selectedId && selectedId !== selection) setSelection(selectedId);
  return [selectedId, setSelection];
}
