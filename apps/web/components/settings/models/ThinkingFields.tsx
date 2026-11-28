"use client";

import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import Editor from "react-simple-code-editor";
import type {
  ModelReasoningControls,
  ModelReasoningLevel,
} from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { checkThinkingLevels } from "@/lib/model-config/client";
import {
  MODEL_REASONING_LEVELS,
  REASONING_OVERRIDE_PRESETS,
  overrideFromControls,
  reasoningOverrideIssue,
  type ReasoningOverride,
  type ThinkingCheckResult,
} from "@/lib/model-config/reasoning-override";
import type { ModelDiscoveryInput } from "@/lib/model-config/schema";
import { cn } from "@/lib/utils";
import { SettingsRow, SettingsSection } from "../SettingsRows";

type CheckTarget = ModelDiscoveryInput & { model: string };

interface Props {
  /** Catalog or saved-detection controls that apply while no override is set. */
  automatic?: ModelReasoningControls;
  value: ReasoningOverride | null;
  onChange: (value: ReasoningOverride | null) => void;
  onInvalidChange: (invalid: boolean) => void;
  /** Omitted when the provider has no template render endpoint. */
  checkTarget?: CheckTarget;
}

export function ThinkingFields({
  automatic,
  value,
  onChange,
  onInvalidChange,
  checkTarget,
}: Props) {
  const { t } = useTranslation();
  // Remount the JSON editor whenever its value is replaced wholesale.
  const [editorKey, setEditorKey] = useState(0);
  function replace(next: ReasoningOverride | null) {
    onInvalidChange(false);
    setEditorKey((key) => key + 1);
    onChange(next);
  }

  return (
    <SettingsSection
      title={t("models.thinking.title")}
      description={t("models.thinking.description")}
    >
      <SettingsRow
        title={t("models.thinking.levelsTitle")}
        htmlFor="p-thinking-mode"
        description={
          value
            ? t("models.thinking.levelsCustomDescription")
            : automatic
              ? describeControls(automatic, t)
              : t("models.thinking.levelsUnknownDescription")
        }
      >
        <Select
          value={value ? "custom" : "automatic"}
          onValueChange={(mode) =>
            replace(
              mode === "custom"
                ? automatic
                  ? overrideFromControls(automatic)
                  : REASONING_OVERRIDE_PRESETS[0].override
                : null,
            )
          }
        >
          <SelectTrigger id="p-thinking-mode">
            <SelectValue>
              {value
                ? t("models.thinking.modeCustom")
                : t("models.thinking.modeAutomatic")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="automatic">
              {t("models.thinking.modeAutomatic")}
            </SelectItem>
            <SelectItem value="custom">
              {t("models.thinking.modeCustom")}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      {value ? (
        <CustomThinkingFields
          key={editorKey}
          value={value}
          onChange={onChange}
          onInvalidChange={onInvalidChange}
          onReplace={replace}
          checkTarget={checkTarget}
        />
      ) : null}
    </SettingsSection>
  );
}

function CustomThinkingFields({
  value,
  onChange,
  onInvalidChange,
  onReplace,
  checkTarget,
}: {
  value: ReasoningOverride;
  onChange: (value: ReasoningOverride) => void;
  onInvalidChange: (invalid: boolean) => void;
  onReplace: (value: ReasoningOverride) => void;
  checkTarget?: CheckTarget;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(() =>
    JSON.stringify(value.requests, null, 2),
  );
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<
    { result: ThinkingCheckResult } | { error: string } | null
  >(null);
  const levels = MODEL_REASONING_LEVELS.filter(
    (level) => level in value.requests,
  );
  const parsedRequests = parseRequests(text, t);
  const jsonError = typeof parsedRequests === "string" ? parsedRequests : null;
  const issue = jsonError ?? reasoningOverrideIssue(value, t);

  function editRequests(next: string) {
    setText(next);
    setCheck(null);
    const parsed = parseRequests(next, t);
    if (typeof parsed === "string") {
      onInvalidChange(true);
      return;
    }
    onInvalidChange(false);
    onChange({
      requests: parsed,
      ...(value.defaultLevel && value.defaultLevel in parsed
        ? { defaultLevel: value.defaultLevel }
        : {}),
    });
  }

  async function runCheck() {
    if (!checkTarget) return;
    setChecking(true);
    setCheck(null);
    try {
      setCheck({
        result: await checkThinkingLevels({
          ...checkTarget,
          reasoningOverride: value,
        }),
      });
    } catch (error) {
      setCheck({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setChecking(false);
    }
  }

  const suggestedDefault =
    check && "result" in check && check.result.status === "checked"
      ? check.result.matchesDefault.length === 1
        ? check.result.matchesDefault[0]
        : undefined
      : undefined;

  return (
    <>
      <SettingsRow
        title={t("models.thinking.presetsTitle")}
        description={t("models.thinking.presetsDescription")}
        align="start"
      >
        <div className="flex flex-wrap gap-2">
          {REASONING_OVERRIDE_PRESETS.map((preset) => (
            <Button
              key={preset.name}
              type="button"
              variant="outline"
              size="sm"
              title={t(`models.thinking.presetDescriptions.${preset.name}`)}
              onClick={() => onReplace(preset.override)}
            >
              {preset.name === "None"
                ? t("models.thinking.presetNone")
                : preset.name}
            </Button>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow
        title={t("models.thinking.requestFieldsTitle")}
        align="start"
        htmlFor="p-thinking-requests"
        description={t("models.thinking.requestFieldsDescription")}
      >
        <div className="space-y-2">
          <div
            className={cn(
              "rounded-lg border border-input bg-transparent motion-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
              issue &&
                "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
            )}
          >
            <Editor
              value={text}
              onValueChange={editRequests}
              highlight={(code) => code}
              tabSize={2}
              insertSpaces
              padding={12}
              textareaId="p-thinking-requests"
              placeholder="{}"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              aria-label={t("models.thinking.requestFieldsAriaLabel")}
              aria-invalid={issue ? true : undefined}
              style={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontSize: "0.8125rem",
                lineHeight: "1.55",
                minHeight: "9rem",
              }}
            />
          </div>
          {issue ? (
            <p className="break-words text-xs text-destructive">{issue}</p>
          ) : null}
        </div>
      </SettingsRow>
      <SettingsRow
        title={t("models.thinking.defaultLevelTitle")}
        htmlFor="p-thinking-default"
        description={t("models.thinking.defaultLevelDescription")}
      >
        <Select
          value={value.defaultLevel ?? ""}
          disabled={levels.length === 0}
          onValueChange={(level) => {
            if (levels.includes(level as ModelReasoningLevel)) {
              onChange({
                ...value,
                defaultLevel: level as ModelReasoningLevel,
              });
            }
          }}
        >
          <SelectTrigger id="p-thinking-default">
            <SelectValue>
              {value.defaultLevel
                ? levelLabel(value.defaultLevel, t)
                : t("models.thinking.chooseLevel")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {levels.map((level) => (
              <SelectItem key={level} value={level}>
                {levelLabel(level, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      {checkTarget ? (
        <SettingsRow
          title={t("models.thinking.checkTitle")}
          align="start"
          description={t("models.thinking.checkDescription")}
        >
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runCheck()}
              disabled={checking || Boolean(issue) || levels.length === 0}
            >
              {checking
                ? t("models.thinking.checking")
                : t("models.thinking.checkWithServer")}
            </Button>
            {check ? (
              <p
                className={cn(
                  "text-xs",
                  "error" in check ? "text-destructive" : "text-muted-foreground",
                )}
                role="status"
              >
                {"error" in check ? check.error : describeCheck(check.result, t)}
              </p>
            ) : null}
            {suggestedDefault && suggestedDefault !== value.defaultLevel ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() =>
                  onChange({ ...value, defaultLevel: suggestedDefault })
                }
              >
                {t("models.thinking.useAsDefault", {
                  level: levelLabel(suggestedDefault, t),
                })}
              </Button>
            ) : null}
          </div>
        </SettingsRow>
      ) : null}
    </>
  );
}

function parseRequests(
  text: string,
  t: TFunction,
): ReasoningOverride["requests"] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (!isRecord(parsed) || !Object.values(parsed).every(isRecord)) {
    return t("models.thinking.requestFieldsMustBeObject");
  }
  return parsed as ReasoningOverride["requests"];
}

function describeControls(controls: ModelReasoningControls, t: TFunction): string {
  const levels = [
    ...(controls.toggle ? ["on", "off"] : []),
    ...(controls.efforts ?? []),
  ].map((level) => levelLabel(level as ModelReasoningLevel, t));
  return t("models.thinking.levelsKnownDescription", {
    levels: levels.join(", "),
    defaultLevel: levelLabel(controls.defaultLevel, t),
  });
}

function describeCheck(result: ThinkingCheckResult, t: TFunction): string {
  if (result.status === "unavailable") {
    return t("models.thinking.checkUnavailable");
  }
  const parts = [
    ...(result.failed.length
      ? [
          t("models.thinking.checkRejected", {
            levels: listLevels(result.failed, t),
          }),
        ]
      : []),
    ...result.identical.map(
      (group) =>
        t("models.thinking.checkIdentical", {
          levels: listLevels(group, t),
        }),
    ),
  ];
  if (parts.length === 0) parts.push(t("models.thinking.checkDistinct"));
  if (result.matchesDefault.length === 1) {
    parts.push(
      t("models.thinking.checkMatchesDefault", {
        level: levelLabel(result.matchesDefault[0], t),
      }),
    );
  }
  return parts.join(" ");
}

function listLevels(levels: ModelReasoningLevel[], t: TFunction): string {
  return levels.map((level) => levelLabel(level, t)).join(", ");
}

function levelLabel(level: ModelReasoningLevel, t: TFunction): string {
  return t(`models.thinking.levels.${level}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
