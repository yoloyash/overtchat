"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  DEFAULT_FONT_ID,
  FONT_OPTIONS,
  FONT_STORAGE_KEY,
  type FontId,
} from "@/lib/fonts";

type ThemeValue = "light" | "dark" | "system";

const STATS_FOR_NERDS_STORAGE_KEY = "overtchat_stats_for_nerds";

const OPTIONS: Array<{ value: ThemeValue; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function GeneralForm() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const current = (mounted ? theme : undefined) as ThemeValue | undefined;
  const [statsForNerds, setStatsForNerds] = useLocalStorage<boolean>(
    STATS_FOR_NERDS_STORAGE_KEY,
    false,
  );
  const [fontId, setFontId] = useLocalStorage<FontId>(FONT_STORAGE_KEY, DEFAULT_FONT_ID);
  const currentFont = mounted ? fontId : DEFAULT_FONT_ID;

  function selectFont(next: FontId) {
    setFontId(next);
    // The blocking script only runs on page load; apply the change live too.
    const opt = FONT_OPTIONS.find((f) => f.id === next);
    const root = document.documentElement;
    if (!opt || opt.cssValue === null) root.style.removeProperty("--app-font-sans");
    else root.style.setProperty("--app-font-sans", opt.cssValue);
  }

  return (
    <div className="max-w-xl space-y-8">
      <header>
        <h1 className="font-heading text-xl font-semibold tracking-tight">General</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Personal preferences for this browser.
        </p>
      </header>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Appearance</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose how overtchat looks to you.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-3 gap-2"
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = current === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border bg-card px-3 py-4 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "border-ring ring-1 ring-ring"
                    : "hover:bg-accent/50",
                )}
              >
                <Icon className="size-4 text-muted-foreground" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Font</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Interface font for this browser. Headings and code are unaffected.
          </p>
        </div>
        <div role="radiogroup" aria-label="Font" className="grid grid-cols-3 gap-2">
          {FONT_OPTIONS.map(({ id, label, cssValue }) => {
            const active = currentFont === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => selectFont(id)}
                style={{ fontFamily: cssValue ?? "var(--font-plus-jakarta-sans)" }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border bg-card px-3 py-4 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "border-ring ring-1 ring-ring" : "hover:bg-accent/50",
                )}
              >
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Messages</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Browser-only message display preferences.
          </p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card px-3 py-3 text-sm">
          <input
            type="checkbox"
            checked={statsForNerds}
            onChange={(e) => setStatsForNerds(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <span className="block font-medium">Stats for nerds</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Show token and speed stats on assistant messages.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
