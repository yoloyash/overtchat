import { useCallback, useState } from "react";
import * as SecureStore from "expo-secure-store";

export function useSecureFlag(
  key: string,
  initial: boolean,
): [boolean, (value: boolean) => void] {
  const [value, setValueState] = useState<boolean>(() => {
    const stored = SecureStore.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
    return initial;
  });

  const setValue = useCallback(
    (next: boolean) => {
      setValueState(next);
      SecureStore.setItem(key, next ? "1" : "0");
    },
    [key],
  );

  return [value, setValue];
}
