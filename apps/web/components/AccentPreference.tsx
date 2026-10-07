"use client";

import { useLayoutEffect } from "react";
import { useTheme } from "next-themes";
import { DEFAULT_ACCENT_ID } from "@overtchat/shared";
import { ACCENT_STORAGE_KEY, applyAccent, applyThemeColor } from "@/lib/accent";
import { useLocalStorage } from "@/lib/useLocalStorage";

export function AccentPreference() {
  const [accent] = useLocalStorage(ACCENT_STORAGE_KEY, DEFAULT_ACCENT_ID);
  const { resolvedTheme } = useTheme();
  useLayoutEffect(() => applyAccent(accent), [accent]);
  useLayoutEffect(() => {
    if (resolvedTheme === "light" || resolvedTheme === "dark") {
      applyThemeColor(accent, resolvedTheme);
    }
  }, [accent, resolvedTheme]);
  return null;
}
