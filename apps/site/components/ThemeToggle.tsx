"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is only known in the browser. Keep the first client render equal
  // to the static HTML, then name the actual switch.
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const isDark = resolvedTheme === "dark";
  const label = hydrated && resolvedTheme
    ? `Switch to ${isDark ? "light" : "dark"} theme`
    : "Toggle color theme";

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <Sun className="theme-icon theme-icon-light" aria-hidden="true" />
      <Moon className="theme-icon theme-icon-dark" aria-hidden="true" />
    </button>
  );
}
