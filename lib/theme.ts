"use client";

import { useEffect } from "react";
import { useLocalStorage } from "./useLocalStorage";

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "overtchat_theme";

function resolveSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const effective = theme === "system" ? resolveSystemTheme() : theme;
  document.documentElement.classList.toggle("dark", effective === "dark");
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useLocalStorage<Theme>(THEME_STORAGE_KEY, "system");

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  return [theme, setTheme];
}
