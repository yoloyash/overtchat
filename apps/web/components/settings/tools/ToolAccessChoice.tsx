"use client";

import { SettingsChoiceGroup } from "../SettingsChoiceGroup";

/**
 * When a skill's instructions reach a model. "Always available" loads them
 * into every chat from the start; "On demand", the recommended choice, loads
 * them once a message needs them, which costs the model one extra step. The
 * stored setting stays a boolean (`alwaysOn`); the words are the choice
 * people make.
 */
export const TOOL_ACCESS_OPTIONS = [
  {
    value: "always",
    label: <span className="whitespace-nowrap">Always available</span>,
  },
  {
    value: "on-demand",
    label: <span className="whitespace-nowrap">On demand</span>,
  },
] as const;

export function ToolAccessChoice({
  label,
  alwaysOn,
  disabled,
  onChange,
}: {
  /** Names what the choice is for, e.g. "Gmail tool access". */
  label: string;
  alwaysOn: boolean;
  disabled?: boolean;
  onChange: (alwaysOn: boolean) => void;
}) {
  return (
    <SettingsChoiceGroup
      label={label}
      value={alwaysOn ? "always" : "on-demand"}
      onValueChange={(value) => onChange(value === "always")}
      options={TOOL_ACCESS_OPTIONS}
      disabled={disabled}
      className="w-auto auto-cols-auto"
    />
  );
}
