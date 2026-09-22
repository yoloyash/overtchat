import * as SecureStore from "expo-secure-store";
import { useCallback, useState } from "react";

const SELECTED_MODEL_KEY = "overtchat.selectedModel";

// Like web's selected model, this is a device-local preference shared by chats.
export function useSelectedModel(): [string | null, (id: string) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    SecureStore.getItem(SELECTED_MODEL_KEY),
  );

  const selectModel = useCallback((id: string) => {
    SecureStore.setItem(SELECTED_MODEL_KEY, id);
    setSelectedId(id);
  }, []);

  return [selectedId, selectModel];
}
