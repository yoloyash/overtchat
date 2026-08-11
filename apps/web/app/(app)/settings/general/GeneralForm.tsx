"use client";

import { useSyncExternalStore } from "react";
import { CornerUpRight, ListEnd, Monitor, Moon, Sun } from "lucide-react";
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
import {
  CONTEXT_METER_STORAGE_KEY,
  DEFAULT_CONTEXT_METER_ENABLED,
} from "@/lib/chat/context-meter";
import {
  DEFAULT_SESSION_COST_ENABLED,
  SESSION_COST_STORAGE_KEY,
} from "@/lib/chat/session-cost";
import {
  AGENT_SEND_BEHAVIOR_STORAGE_KEY,
  DEFAULT_AGENT_SEND_BEHAVIOR,
  type AgentSendBehavior,
} from "@/lib/agents/send-behavior";

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
  const [contextMeterEnabled, setContextMeterEnabled] =
    useLocalStorage<boolean>(
      CONTEXT_METER_STORAGE_KEY,
      DEFAULT_CONTEXT_METER_ENABLED,
    );
  const [sessionCostEnabled, setSessionCostEnabled] =
    useLocalStorage<boolean>(
      SESSION_COST_STORAGE_KEY,
      DEFAULT_SESSION_COST_ENABLED,
    );
  const [fontId, setFontId] = useLocalStorage<FontId>(FONT_STORAGE_KEY, DEFAULT_FONT_ID);
  const [agentSendBehavior, setAgentSendBehavior] =
    useLocalStorage<AgentSendBehavior>(
      AGENT_SEND_BEHAVIOR_STORAGE_KEY,
      DEFAULT_AGENT_SEND_BEHAVIOR,
    );
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
        description="Preferences saved for this browser."
      />

      <SettingsSection
        title="Appearance"
        description="Choose how overtchat looks and reads."
      >
        <SettingsRow
          title="Theme"
          description="Use a fixed theme or follow the system setting."
          align="center"
          controlAlign="end"
        >
          <RadioGroup
            aria-label="Theme"
            value={current}
            onValueChange={(next) => setTheme(next as ThemeValue)}
            className="grid w-full grid-cols-3 gap-1 rounded-lg border bg-muted/30 p-1 @2xl:max-w-xs"
          >
            {OPTIONS.map(({ value, label, icon: Icon }) => (
              <Label
                key={value}
                className="flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground motion-colors outline-none has-data-[checked]:bg-background has-data-[checked]:text-foreground has-data-[checked]:shadow-xs has-focus-visible:ring-3 has-focus-visible:ring-ring/50 not-has-data-[checked]:hover:text-foreground"
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
          controlAlign="end"
        >
          <Select value={currentFont} onValueChange={(next) => selectFont(next as FontId)}>
            <SelectTrigger aria-label="Chat font" className="w-full @2xl:w-64">
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
        title="Agents"
        description="Choose how messages sent during an active agent turn behave."
      >
        <SettingsRow
          title="Default send"
          description={
            agentSendBehavior === "queue"
              ? "While an agent is working, Enter queues. Command/Ctrl+Enter steers."
              : "While an agent is working, Enter steers. Command/Ctrl+Enter queues."
          }
          align="center"
          controlAlign="end"
        >
          <RadioGroup
            aria-label="Default agent send behavior"
            value={agentSendBehavior}
            onValueChange={(next) =>
              setAgentSendBehavior(next as AgentSendBehavior)
            }
            className="grid w-full grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1 @2xl:max-w-xs"
          >
            {([
              { value: "steer", label: "Steer", icon: CornerUpRight },
              { value: "queue", label: "Queue", icon: ListEnd },
            ] as const).map(({ value, label, icon: Icon }) => (
              <Label
                key={value}
                className="flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground motion-colors outline-none has-data-[checked]:bg-background has-data-[checked]:text-foreground has-data-[checked]:shadow-xs has-focus-visible:ring-3 has-focus-visible:ring-ring/50 not-has-data-[checked]:hover:text-foreground"
              >
                <RadioGroupItem value={value} className="sr-only" />
                <Icon className="size-3.5" />
                <span>{label}</span>
              </Label>
            ))}
          </RadioGroup>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Messages"
        description="Message display preferences saved for this browser."
      >
        <SettingsRow
          title="Message stats"
          description="Show token counts and speed stats on assistant messages."
          htmlFor="message-stats"
          align="center"
          controlAlign="end"
        >
          <Switch
            id="message-stats"
            checked={messageStatsEnabled}
            onCheckedChange={(next) => setMessageStatsEnabled(next)}
            aria-label="Show message stats"
          />
        </SettingsRow>

        <SettingsRow
          title="Context meter"
          description="Show context-window usage in the chat header."
          htmlFor="context-meter"
          align="center"
          controlAlign="end"
        >
          <Switch
            id="context-meter"
            checked={contextMeterEnabled}
            onCheckedChange={(next) => setContextMeterEnabled(next)}
            aria-label="Show context meter"
          />
        </SettingsRow>

        <SettingsRow
          title="Session cost"
          description="Show session cost in the chat header."
          htmlFor="session-cost"
          align="center"
          controlAlign="end"
        >
          <Switch
            id="session-cost"
            checked={sessionCostEnabled}
            onCheckedChange={(next) => setSessionCostEnabled(next)}
            aria-label="Show session cost"
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
