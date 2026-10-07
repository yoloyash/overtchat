"use client";

import { useLayoutEffect } from "react";
import { DEFAULT_ACCENT_ID } from "@overtchat/shared";
import { ACCENT_STORAGE_KEY, applyAccent } from "@/lib/accent";
import { useLocalStorage } from "@/lib/useLocalStorage";

export function AccentPreference() {
  const [accent] = useLocalStorage(ACCENT_STORAGE_KEY, DEFAULT_ACCENT_ID);
  useLayoutEffect(() => applyAccent(accent), [accent]);
  return null;
}
