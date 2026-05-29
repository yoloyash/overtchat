"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
        <h1 className="text-xl font-semibold tracking-tight">General</h1>
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
        <RadioGroup
          aria-label="Theme"
          value={current}
          onValueChange={(next) => setTheme(next as ThemeValue)}
          className="grid grid-cols-3 gap-2"
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <Label
              key={value}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border bg-card px-3 py-4 text-sm font-normal transition-colors outline-none has-data-[checked]:border-ring has-data-[checked]:ring-1 has-data-[checked]:ring-ring has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50 not-has-data-[checked]:hover:bg-accent/50"
            >
              <RadioGroupItem value={value} className="sr-only" />
              <Icon className="size-4 text-muted-foreground" />
              <span>{label}</span>
            </Label>
          ))}
        </RadioGroup>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Font</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose the font used in the app.
          </p>
        </div>
        <Select value={currentFont} onValueChange={(next) => selectFont(next as FontId)}>
          <SelectTrigger aria-label="Font" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_OPTIONS.map(({ id, label, cssValue }) => (
              <SelectItem
                key={id}
                value={id}
                style={{ fontFamily: cssValue ?? "var(--font-plus-jakarta-sans)" }}
              >
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Messages</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Browser-only message display preferences.
          </p>
        </div>
        <Label
          htmlFor="stats-for-nerds"
          className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border bg-card px-3 py-3 text-sm font-normal"
        >
          <span>
            <span className="block font-medium">Stats for nerds</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Show token and speed stats on assistant messages.
            </span>
          </span>
          <Switch
            id="stats-for-nerds"
            checked={statsForNerds}
            onCheckedChange={(next) => setStatsForNerds(next)}
            className="mt-0.5"
          />
        </Label>
      </section>
    </div>
  );
}
