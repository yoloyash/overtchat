import type { TFunction } from "i18next";
import { i18n } from "@overtchat/shared/i18n";
import {
  buildAgentPromptCommand,
  normalizeAgentSessionCommand,
  type AgentMode,
  type AgentModel,
  type AgentPromptImage,
  type AgentRuntimeSnapshot,
  type AgentSessionCommand,
} from "@overtchat/agent-bridge";

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function sessionModes(snapshot: AgentRuntimeSnapshot): AgentMode[] {
  return Array.isArray(snapshot.state.modes)
    ? snapshot.state.modes.flatMap((value) => {
        const mode = record(value);
        return typeof mode.id === "string" && typeof mode.label === "string"
          ? [
              {
                id: mode.id,
                label: mode.label,
                description: text(mode.description),
                dangerous: mode.dangerous === true,
              },
            ]
          : [];
      })
    : [];
}

/** The session's current model: its ID and catalog entry, when listed. */
export function sessionModel(snapshot: AgentRuntimeSnapshot): {
  id: string;
  model: AgentModel | undefined;
} {
  const id = text(record(snapshot.state.model).id);
  return { id, model: snapshot.models.find((item) => item.id === id) };
}

const THINKING_LEVEL_KEYS = {
  off: "agents.composer.thinking.off",
  minimal: "agents.composer.thinking.minimal",
  low: "agents.composer.thinking.low",
  medium: "agents.composer.thinking.medium",
  high: "agents.composer.thinking.high",
  xhigh: "agents.composer.thinking.xhigh",
  max: "agents.composer.thinking.max",
  default: "agents.composer.thinking.default",
} as const;

export function thinkingOptionLabel(
  id: string,
  fallbackLabel?: string,
  t: TFunction = i18n.t.bind(i18n),
): string | undefined {
  if (Object.hasOwn(THINKING_LEVEL_KEYS, id)) {
    return t(THINKING_LEVEL_KEYS[id as keyof typeof THINKING_LEVEL_KEYS]);
  }
  if (fallbackLabel) return fallbackLabel;
  return id ? id[0].toUpperCase() + id.slice(1) : undefined;
}

export function thinkingLabel(
  model: AgentModel | undefined,
  level: string,
  t: TFunction = i18n.t.bind(i18n),
): string | undefined {
  if (!model?.thinkingOptions?.length) return undefined;
  const option = model.thinkingOptions.find((item) => item.id === level);
  return thinkingOptionLabel(level, option?.label, t);
}

export function submitCommand(
  snapshot: AgentRuntimeSnapshot,
  message: string,
  images: AgentPromptImage[],
): AgentSessionCommand {
  const normalized =
    snapshot.capabilities.usage &&
    !images.length &&
    /^\/usage\s*$/iu.test(message)
      ? ({ type: "show_usage" } as const)
      : normalizeAgentSessionCommand(
          buildAgentPromptCommand(message, images),
          snapshot.state,
        );
  return normalized.type === "prompt" &&
    (snapshot.status === "running" || snapshot.state.isCompacting === true)
    ? { ...normalized, type: "queue" }
    : normalized;
}

export function prepareSubmission(
  snapshot: AgentRuntimeSnapshot,
  message: string,
  images: AgentPromptImage[],
  pending: { fingerprint: string; command: AgentSessionCommand } | undefined,
  makeId: () => string,
) {
  const fingerprint = submissionFingerprint(message, images);
  let command =
    pending?.fingerprint === fingerprint
      ? pending.command
      : submitCommand(snapshot, message.trim(), images);
  if (command.type === "prompt" || command.type === "queue") {
    command = {
      ...command,
      clientMessageId: command.clientMessageId ?? makeId(),
    };
    return { command, pending: { fingerprint, command } };
  }
  return { command, pending: undefined };
}

export function submissionFingerprint(
  message: string,
  images: AgentPromptImage[],
) {
  return JSON.stringify({
    message: message.trim(),
    images: images.map(({ uploadId, filename, mediaType }) => ({
      uploadId,
      filename,
      mediaType,
    })),
  });
}

export function sessionStatus(snapshot: AgentRuntimeSnapshot): string {
  if (snapshot.readOnly) return i18n.t("agents.mobile.status.readOnly");
  if (snapshot.pendingInteraction)
    return i18n.t("agents.mobile.status.waitingForYou");
  if (snapshot.state.isCompacting)
    return i18n.t("agents.activity.status.compacting");
  if (snapshot.status === "running")
    return i18n.t("agents.activity.status.working");
  if (snapshot.status === "exited")
    return i18n.t("agents.mobile.status.stopped");
  return i18n.t("agents.mobile.status.ready");
}

// Only attach credentials to images served by the selected OvertChat server.
export function agentImageSource(url: string, server: string, cookie: string) {
  try {
    const resolved = new URL(url, server);
    const local =
      resolved.origin === new URL(server).origin &&
      resolved.pathname.startsWith("/api/uploads/");
    if (local) return { uri: resolved.toString(), headers: { Cookie: cookie } };
    if (
      resolved.protocol === "data:" &&
      /^data:image\/(png|jpeg|gif|webp);base64,/u.test(url)
    )
      return { uri: url };
  } catch {
    /* Invalid image references are omitted. */
  }
  return null;
}
