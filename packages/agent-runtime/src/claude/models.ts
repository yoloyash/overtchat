import type {
  AgentMode,
  AgentModel,
  AgentSelectOption,
} from "@overtchat/agent-bridge";
import type { ModelInfo, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const EXTENDED_CONTEXT_WINDOW = 1_000_000;

export type ClaudeSettingsModel = {
  id: string;
  description: string;
};

const CLAUDE_SETTINGS_MODELS_SCRIPT = String.raw`
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const keys = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
];
const found = [];
const add = (value, source) => {
  if (typeof value !== "string" || !value.trim()) return;
  const id = value.trim();
  if (!found.some((model) => model.id === id)) found.push({ id, description: "From Claude settings.json " + source });
};
try {
  const settings = JSON.parse(fs.readFileSync(path.join(config, "settings.json"), "utf8"));
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    add(settings.model, "model");
    if (settings.env && typeof settings.env === "object" && !Array.isArray(settings.env)) {
      for (const key of keys) add(settings.env[key], "env." + key);
    }
  }
} catch {}
process.stdout.write(JSON.stringify(found));
`.trim();

export const CLAUDE_MODES: readonly AgentMode[] = [
  {
    id: "plan",
    label: "Plan",
    description: "Inspect and plan without modifying the workspace.",
  },
  {
    id: "default",
    label: "Always Ask",
    description: "Ask before actions that require permission.",
  },
  {
    id: "acceptEdits",
    label: "Accept Edits",
    description: "Approve workspace file edits while asking for other actions.",
  },
  {
    id: "auto",
    label: "Auto",
    description: "Let Claude classify routine actions and ask when needed.",
  },
  {
    id: "bypassPermissions",
    label: "Bypass Permissions",
    description: "Run tools without approval prompts.",
    dangerous: true,
  },
];

export function isClaudePermissionMode(value: string): value is PermissionMode {
  return CLAUDE_MODES.some((mode) => mode.id === value);
}

function thinkingOptions(model: ModelInfo): AgentSelectOption[] {
  const effort = model.supportedEffortLevels ?? [];
  const options: AgentSelectOption[] = [
    {
      id: "off",
      label: "Off",
      description: "Disable extended thinking.",
    },
  ];
  if (model.supportsAdaptiveThinking || effort.length > 0) {
    const levels = effort.length > 0 ? effort : (["low", "medium", "high"] as const);
    options.push(
      ...levels.map((level) => ({
        id: level,
        label: level === "xhigh" ? "Extra High" : `${level[0]?.toUpperCase()}${level.slice(1)}`,
        isDefault: level === "high",
      })),
    );
  }
  return options;
}

function configuredModel(model: ClaudeSettingsModel): AgentModel {
  return {
    provider: "claude",
    id: model.id,
    label: model.id,
    description: model.description,
    api: "claude-agent-sdk",
    baseUrl: "",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: model.id.toLowerCase().includes("[1m]")
      ? EXTENDED_CONTEXT_WINDOW
      : DEFAULT_CONTEXT_WINDOW,
    maxTokens: null,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

export function parseClaudeModels(
  models: readonly ModelInfo[],
  settingsModels: readonly ClaudeSettingsModel[] = [],
): AgentModel[] {
  const discovered: AgentModel[] = models.map((model, index) => {
    const options = thinkingOptions(model);
    const resolvedModel = "resolvedModel" in model &&
        typeof model.resolvedModel === "string"
      ? model.resolvedModel
      : model.value;
    return {
      provider: "claude",
      id: model.value,
      label: model.displayName || model.value,
      description: model.description || undefined,
      isDefault: index === 0,
      api: "claude-agent-sdk",
      baseUrl: "",
      reasoning: options.length > 1,
      input: ["text", "image"],
      metadata: { provider: "anthropic", modelId: resolvedModel },
      contextWindow: `${model.value} ${resolvedModel}`.toLowerCase().includes("[1m]")
        ? EXTENDED_CONTEXT_WINDOW
        : DEFAULT_CONTEXT_WINDOW,
      maxTokens: null,
      thinkingOptions: options,
      defaultThinkingOptionId: options.some((option) => option.id === "high")
        ? "high"
        : options.at(-1)?.id ?? "off",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  });
  const discoveredIds = new Set(discovered.map((model) => model.id));
  return [
    ...discovered,
    ...settingsModels
      .filter((model) => !discoveredIds.has(model.id))
      .map(configuredModel),
  ];
}

export function claudeModesForModels(models: readonly ModelInfo[]): AgentMode[] {
  const supportsAuto = models.some((model) => model.supportsAutoMode === true);
  return CLAUDE_MODES.filter((mode) => mode.id !== "auto" || supportsAuto);
}

export async function readClaudeSettingsModels(
  target: HostTarget,
): Promise<ClaudeSettingsModel[]> {
  try {
    const result = await executeOnHost(target, {
      command: "node",
      args: ["-e", CLAUDE_SETTINGS_MODELS_SCRIPT],
    });
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const id = Reflect.get(candidate, "id");
      const description = Reflect.get(candidate, "description");
      return typeof id === "string" && id.trim() && typeof description === "string"
        ? [{ id: id.trim(), description }]
        : [];
    });
  } catch {
    return [];
  }
}
