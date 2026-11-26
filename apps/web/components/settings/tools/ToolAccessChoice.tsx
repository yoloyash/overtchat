"use client";

import { useTranslation } from "react-i18next";
import { SettingsChoiceGroup } from "../SettingsChoiceGroup";

/**
 * When a skill's instructions reach a model. "Always available" loads them
 * into every chat from the start; "On demand", the recommended choice, loads
 * them once a message needs them, which costs the model one extra step. The
 * stored setting stays a boolean (`alwaysOn`); the words are the choice
 * people make.
 */
const TOOL_ACCESS_VALUES = ["always", "on-demand"] as const;

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
  const { t } = useTranslation();
  const options = TOOL_ACCESS_VALUES.map((value) => ({
    value,
    label: (
      <span className="whitespace-nowrap">
        {value === "always"
          ? t("tools.accessChoice.alwaysAvailable")
          : t("tools.accessChoice.onDemand")}
      </span>
    ),
  }));
  return (
    <SettingsChoiceGroup
      label={label}
      value={alwaysOn ? "always" : "on-demand"}
      onValueChange={(value) => onChange(value === "always")}
      options={options}
      disabled={disabled}
      className="w-auto auto-cols-auto"
    />
  );
}
