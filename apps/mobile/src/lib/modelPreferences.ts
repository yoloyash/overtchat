import * as SecureStore from "expo-secure-store";
import { useCallback, useState } from "react";
import { resolveChatModelId } from "@overtchat/shared";

const SELECTED_MODEL_KEY = "overtchat.selectedModel";

export function useSelectedModel(
  models: readonly { id: string }[] | undefined,
  initialModelId?: string | null,
): [string, (id: string) => void] {
  const [rememberedId] = useState<string | null>(() =>
    SecureStore.getItem(SELECTED_MODEL_KEY),
  );
  const [selection, setSelectedId] = useState<string | null>(
    initialModelId ?? null,
  );
  const selectedId = resolveChatModelId(models ?? [], selection, rememberedId);
  if (selectedId && selectedId !== selection) setSelectedId(selectedId);

  const selectModel = useCallback((id: string) => {
    SecureStore.setItem(SELECTED_MODEL_KEY, id);
    setSelectedId(id);
  }, []);

  return [selectedId, selectModel];
}
