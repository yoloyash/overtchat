import { useState } from "react";
import { resolveChatModelId } from "@overtchat/shared";
import { useModelPreferences } from "@/lib/queries/modelPreferences";
import { useOptionalProject } from "@/lib/queries/projects";

export function useSelectedModel(
  models: readonly { id: string }[] | undefined,
  initialModelId?: string | null,
  projectId?: string | null,
): [string, (id: string) => void] {
  const preferences = useModelPreferences();
  const project = useOptionalProject(projectId);
  const [selection, setSelection] = useState<string | null>(
    initialModelId ?? null,
  );
  // Wait for this mount's default refresh before initializing a new chat.
  const waiting =
    !models?.some((model) => model.id === selection) &&
    (preferences.isPending ||
      preferences.isFetching ||
      (Boolean(projectId) && project.isPending));
  const selectedId = waiting
    ? ""
    : resolveChatModelId(
        models ?? [],
        selection,
        project.data?.defaultModelId,
        preferences.data?.defaultModelId,
      );
  if (selectedId && selectedId !== selection) setSelection(selectedId);
  return [selectedId, setSelection];
}
