import { z } from "zod";
import {
  REASONING_EFFORTS,
  type ModelReasoningControls,
  type ModelReasoningLevel,
} from "@overtchat/shared";

export const MODEL_REASONING_LEVELS = [
  "on",
  "off",
  ...REASONING_EFFORTS,
] as const satisfies readonly ModelReasoningLevel[];

export type ReasoningRequestFields = Record<string, unknown>;

/**
 * Administrator-declared thinking levels for an OpenAI-compatible local model.
 * Each level's fields are merged into the Chat Completions body as a JSON Merge
 * Patch (RFC 7396). An empty `requests` object hides the thinking selector.
 */
export interface ReasoningOverride {
  /** Level the server applies when no thinking field is sent. */
  defaultLevel?: ModelReasoningLevel;
  requests: Partial<Record<ModelReasoningLevel, ReasoningRequestFields>>;
}

const RequestFieldsSchema = z.record(z.string(), z.unknown());

export const ReasoningOverrideSchema = z
  .object({
    defaultLevel: z.enum(MODEL_REASONING_LEVELS).optional(),
    requests: z.record(z.string(), RequestFieldsSchema),
  })
  .superRefine((value, context) => {
    const issue = reasoningOverrideIssue(value);
    if (issue) context.addIssue({ code: "custom", message: issue });
  })
  .transform((value) => value as ReasoningOverride);

/** Ignores malformed persisted data so chat keeps automatic behavior. */
export function readReasoningOverride(value: unknown): ReasoningOverride | null {
  const parsed = ReasoningOverrideSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function reasoningOverrideIssue(value: {
  defaultLevel?: string;
  requests: Record<string, unknown>;
}): string | undefined {
  const levels = Object.keys(value.requests);
  const unknown = levels.find(
    (level) => !(MODEL_REASONING_LEVELS as readonly string[]).includes(level),
  );
  if (unknown !== undefined) {
    return `Unknown thinking level "${unknown}". Use ${MODEL_REASONING_LEVELS.join(", ")}.`;
  }
  if (levels.length === 0) return undefined;
  const hasEfforts = levels.some((level) =>
    (REASONING_EFFORTS as readonly string[]).includes(level),
  );
  if (!hasEfforts && !(levels.includes("on") && levels.includes("off"))) {
    return "Configure both on and off, or at least one effort level.";
  }
  if (!value.defaultLevel) return "Choose the server's default thinking level.";
  if (!levels.includes(value.defaultLevel)) {
    return "The default thinking level must be one of the configured levels.";
  }
  if (hasEfforts && levels.includes("on") && value.defaultLevel !== "on") {
    return 'With effort levels configured, "on" is only offered as the default level.';
  }
  return undefined;
}

/** Public controls for a valid override; undefined hides the selector. */
export function reasoningControlsFromOverride(
  override: ReasoningOverride,
): ModelReasoningControls | undefined {
  const { defaultLevel, requests } = override;
  const efforts = REASONING_EFFORTS.filter((effort) => effort in requests);
  if (!defaultLevel || (efforts.length === 0 && !("off" in requests))) {
    return undefined;
  }
  return {
    toggle: "off" in requests,
    defaultLevel,
    ...(efforts.length > 0 ? { efforts } : {}),
  };
}

/** Fields sent for models without an override, kept for saved detections. */
export function legacyReasoningFields(
  level: ModelReasoningLevel,
): ReasoningRequestFields {
  return {
    reasoning_effort:
      level === "off" ? "none" : level === "on" ? null : level,
    chat_template_kwargs: { enable_thinking: level !== "off" },
  };
}

/** An override that sends exactly what automatic controls send today. */
export function overrideFromControls(
  controls: ModelReasoningControls,
): ReasoningOverride {
  const levels: ModelReasoningLevel[] = controls.efforts?.length
    ? [
        ...(controls.toggle ? (["off"] as const) : []),
        ...(controls.defaultLevel === "on" ? (["on"] as const) : []),
        ...controls.efforts,
      ]
    : controls.toggle
      ? ["on", "off"]
      : [];
  return {
    defaultLevel: controls.defaultLevel,
    requests: Object.fromEntries(
      levels.map((level) => [level, legacyReasoningFields(level)]),
    ),
  };
}

export type ThinkingCheckResult =
  | { status: "unavailable" }
  | {
      status: "checked";
      /** Levels whose fields the server rejected. */
      failed: ModelReasoningLevel[];
      /** Groups of two or more levels that render the same prompt. */
      identical: ModelReasoningLevel[][];
      /** Levels that render like a request without thinking fields. */
      matchesDefault: ModelReasoningLevel[];
    };

export const REASONING_OVERRIDE_PRESETS = [
  {
    name: "enable_thinking",
    description: "On/Off through chat_template_kwargs.enable_thinking",
    override: toggleOverride("enable_thinking"),
  },
  {
    name: "thinking",
    description: "On/Off through chat_template_kwargs.thinking",
    override: toggleOverride("thinking"),
  },
  {
    name: "reasoning_effort",
    description: "Low, medium, and high through reasoning_effort",
    override: {
      defaultLevel: "medium",
      requests: {
        low: { reasoning_effort: "low" },
        medium: { reasoning_effort: "medium" },
        high: { reasoning_effort: "high" },
      },
    },
  },
  {
    name: "None",
    description: "Hide the thinking selector",
    override: { requests: {} },
  },
] as const satisfies readonly {
  name: string;
  description: string;
  override: ReasoningOverride;
}[];

function toggleOverride(parameter: string): ReasoningOverride {
  return {
    defaultLevel: "on",
    requests: {
      on: { chat_template_kwargs: { [parameter]: true } },
      off: { chat_template_kwargs: { [parameter]: false } },
    },
  };
}

/** RFC 7396: objects merge recursively, null removes, other values replace. */
export function mergeRequestFields(
  target: Record<string, unknown>,
  patch: ReasoningRequestFields,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else if (isRecord(value)) {
      result[key] = mergeRequestFields(
        isRecord(result[key]) ? result[key] : {},
        value,
      );
    } else result[key] = value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
