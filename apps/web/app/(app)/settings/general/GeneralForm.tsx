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
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../_components/SettingsRows";
import {
  DEFAULT_FONT_ID,
  FONT_OPTIONS,
  FONT_STORAGE_KEY,
  type FontId,
} from "@/lib/fonts";

type ThemeValue = "light" | "dark" | "system";

const MESSAGE_STATS_STORAGE_KEY = "overtchat_stats_for_nerds";

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
  const [messageStatsEnabled, setMessageStatsEnabled] = useLocalStorage<boolean>(
    MESSAGE_STATS_STORAGE_KEY,
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
    <div className="max-w-3xl space-y-8">
      <SettingsPageHeader
        title="General"
        description="Personal preferences for this browser."
      />

      <SettingsSection
        title="Appearance"
        description="Choose how overtchat looks and reads."
      >
        <SettingsRow
          title="Theme"
          description="Use a fixed theme or follow the system setting."
          align="center"
        >
          <RadioGroup
            aria-label="Theme"
            value={current}
            onValueChange={(next) => setTheme(next as ThemeValue)}
            className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/30 p-1"
          >
            {OPTIONS.map(({ value, label, icon: Icon }) => (
              <Label
                key={value}
                className="flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors outline-none has-data-[checked]:bg-background has-data-[checked]:text-foreground has-data-[checked]:shadow-xs has-focus-visible:ring-3 has-focus-visible:ring-ring/50 not-has-data-[checked]:hover:text-foreground"
              >
                <RadioGroupItem value={value} className="sr-only" />
                <Icon className="size-3.5" />
                <span>{label}</span>
              </Label>
            ))}
          </RadioGroup>
        </SettingsRow>

        <SettingsRow
          title="Chat font"
          description="Choose the font used throughout the app."
          align="center"
        >
          <Select value={currentFont} onValueChange={(next) => selectFont(next as FontId)}>
            <SelectTrigger aria-label="Chat font" className="w-full">
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
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Messages"
        description="Browser-only message display preferences."
      >
        <SettingsRow
          title="Message stats"
          description="Show token counts and speed stats on assistant messages."
          htmlFor="message-stats"
          align="center"
        >
          <Switch
            id="message-stats"
            checked={messageStatsEnabled}
            onCheckedChange={(next) => setMessageStatsEnabled(next)}
            aria-label="Show message stats"
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
