"use client";

import { useState } from "react";
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
  // Remount the JSON editor whenever its value is replaced wholesale.
  const [editorKey, setEditorKey] = useState(0);
  function replace(next: ReasoningOverride | null) {
    onInvalidChange(false);
    setEditorKey((key) => key + 1);
    onChange(next);
  }

  return (
    <SettingsSection
      title="Thinking"
      description="Thinking levels offered in chat and the request fields each level sends."
    >
      <SettingsRow
        title="Levels"
        htmlFor="p-thinking-mode"
        description={
          value
            ? "Custom levels replace catalog and detected values."
            : automatic
              ? `Known levels: ${describeControls(automatic)}.`
              : "No thinking levels are known for this model. Choose Custom to configure them."
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
            <SelectValue>{value ? "Custom" : "Automatic"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="automatic">Automatic</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
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
  const [text, setText] = useState(() =>
    JSON.stringify(value.requests, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<
    { result: ThinkingCheckResult } | { error: string } | null
  >(null);
  const levels = MODEL_REASONING_LEVELS.filter(
    (level) => level in value.requests,
  );
  const issue = jsonError ?? reasoningOverrideIssue(value);

  function editRequests(next: string) {
    setText(next);
    setCheck(null);
    const parsed = parseRequests(next);
    if (typeof parsed === "string") {
      setJsonError(parsed);
      onInvalidChange(true);
      return;
    }
    setJsonError(null);
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
        title="Presets"
        description="Replace the request fields with a common convention."
        align="start"
      >
        <div className="flex flex-wrap gap-2">
          {REASONING_OVERRIDE_PRESETS.map((preset) => (
            <Button
              key={preset.name}
              type="button"
              variant="outline"
              size="sm"
              title={preset.description}
              onClick={() => onReplace(preset.override)}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow
        title="Request fields"
        align="start"
        htmlFor="p-thinking-requests"
        description="One entry per level: on, off, minimal, low, medium, high, xhigh, or max. Each entry is merged into the request body; null removes a field. An empty object hides the thinking selector."
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
              aria-label="Thinking request fields JSON"
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
        title="Default level"
        htmlFor="p-thinking-default"
        description="What the server does when no thinking field is sent. Chat marks it as the default."
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
                ? levelLabel(value.defaultLevel)
                : "Choose a level"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {levels.map((level) => (
              <SelectItem key={level} value={level}>
                {levelLabel(level)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      {checkTarget ? (
        <SettingsRow
          title="Check"
          align="start"
          description="Renders the prompt template for each level without generating a reply. Fields the server handles outside the template aren't reflected."
        >
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runCheck()}
              disabled={checking || Boolean(issue) || levels.length === 0}
            >
              {checking ? "Checking…" : "Check with server"}
            </Button>
            {check ? (
              <p
                className={cn(
                  "text-xs",
                  "error" in check ? "text-destructive" : "text-muted-foreground",
                )}
                role="status"
              >
                {"error" in check ? check.error : describeCheck(check.result)}
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
                Use {levelLabel(suggestedDefault)} as default
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
): ReasoningOverride["requests"] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (!isRecord(parsed) || !Object.values(parsed).every(isRecord)) {
    return "Must be a JSON object whose values are objects.";
  }
  return parsed as ReasoningOverride["requests"];
}

function describeControls(controls: ModelReasoningControls): string {
  const levels = [
    ...(controls.toggle ? ["on", "off"] : []),
    ...(controls.efforts ?? []),
  ].map((level) => levelLabel(level as ModelReasoningLevel));
  return `${levels.join(", ")} (default ${levelLabel(controls.defaultLevel)})`;
}

function describeCheck(result: ThinkingCheckResult): string {
  if (result.status === "unavailable") {
    return "This server has no template render endpoint, so the fields can't be checked without generating.";
  }
  const parts = [
    ...(result.failed.length
      ? [`The server rejected the fields for ${listLevels(result.failed)}.`]
      : []),
    ...result.identical.map(
      (group) => `${listLevels(group)} render the same prompt.`,
    ),
  ];
  if (parts.length === 0) parts.push("Each level renders a distinct prompt.");
  if (result.matchesDefault.length === 1) {
    parts.push(
      `Without thinking fields, the server renders like ${levelLabel(result.matchesDefault[0])}.`,
    );
  }
  return parts.join(" ");
}

function listLevels(levels: ModelReasoningLevel[]): string {
  return levels.map(levelLabel).join(", ");
}

function levelLabel(level: ModelReasoningLevel): string {
  if (level === "xhigh") return "Extra high";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
