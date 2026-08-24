import type {
  AgentModel,
  AgentSlashCommand,
  AgentSessionStats,
} from "@overtchat/agent-bridge";
import type {
  AgentSubmissionOptions,
  ResolvedAgentImage,
} from "@overtchat/agent-runtime/providers/types";
import {
  parsePiCommands,
  parsePiModels,
  parsePiSessionStats,
  type PiRpcCommand,
  type PiRpcEvent,
} from "@overtchat/agent-runtime/pi/protocol";
import { JsonlRpcTransport } from "@overtchat/agent-runtime/runtime/jsonl-rpc";
import {
  type AgentProcess,
  type HostTarget,
  spawnOnHost,
} from "@overtchat/agent-runtime/runtime/process";

export type PiLaunch = {
  executable: string;
  cwd?: string;
  env?: Record<string, string>;
  sessionPath?: string;
  noSession?: boolean;
  model?: string;
  thinkingOptionId?: string;
  extraArgs?: string[];
};

function promptFrame(
  type: "prompt" | "steer",
  message: string,
  images: readonly ResolvedAgentImage[],
) {
  return {
    type,
    message,
    ...(images.length
      ? {
          images: images.map((image) => ({
            data: image.data,
            mimeType: image.mediaType,
          })),
        }
      : {}),
  };
}

export class PiClient {
  private readonly transport: JsonlRpcTransport;
  private readonly subscribers = new Set<(event: PiRpcEvent) => void>();

  constructor(process: AgentProcess) {
    this.transport = new JsonlRpcTransport(process, "Pi");
    this.transport.onRecord((record) => {
      if (typeof record.type !== "string") {
        this.transport.fail("Pi RPC event is missing a type.");
        return;
      }
      this.emit(
        record.type === "extension_ui_request"
          ? ({ ...record, type: "interaction_request" } as PiRpcEvent)
          : (record as PiRpcEvent),
      );
    });
  }

  onEvent(subscriber: (event: PiRpcEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  request<T = unknown>(command: PiRpcCommand, timeoutMs?: number): Promise<T> {
    return this.transport.request(command, timeoutMs);
  }

  async getState(timeoutMs?: number): Promise<Record<string, unknown>> {
    const state = await this.request<Record<string, unknown>>(
      { type: "get_state" },
      timeoutMs,
    );
    const model = state.model;
    const nativeProvider =
      model && typeof model === "object" && !Array.isArray(model)
        ? Reflect.get(model, "provider")
        : undefined;
    const nativeModelId =
      model && typeof model === "object" && !Array.isArray(model)
        ? Reflect.get(model, "id")
        : undefined;
    return typeof nativeProvider === "string" && typeof nativeModelId === "string"
      ? { ...state, model: { provider: "pi", id: `${nativeProvider}/${nativeModelId}` } }
      : state;
  }

  async getAvailableModels(timeoutMs?: number): Promise<AgentModel[]> {
    return parsePiModels(
      await this.request({ type: "get_available_models" }, timeoutMs),
    );
  }

  async getSessionStats(): Promise<AgentSessionStats> {
    return parsePiSessionStats(await this.request({ type: "get_session_stats" }));
  }

  async getCommands(): Promise<AgentSlashCommand[]> {
    return parsePiCommands(await this.request({ type: "get_commands" }));
  }

  getMessages(): Promise<{ messages: unknown[] }> {
    return this.request({ type: "get_messages" });
  }

  prompt(
    message: string,
    images: readonly ResolvedAgentImage[] = [],
    _options: AgentSubmissionOptions = {},
  ): Promise<unknown> {
    return this.request(promptFrame("prompt", message, images));
  }

  steer(
    message: string,
    images: readonly ResolvedAgentImage[] = [],
    _options: AgentSubmissionOptions = {},
  ): Promise<unknown> {
    return this.request(promptFrame("steer", message, images));
  }

  abort(): Promise<unknown> {
    return this.request({ type: "abort" });
  }

  setModel(modelId: string): Promise<unknown> {
    const separator = modelId.indexOf("/");
    if (separator <= 0 || separator === modelId.length - 1) {
      throw new Error("Pi model id must include its provider.");
    }
    return this.request({
      type: "set_model",
      provider: modelId.slice(0, separator),
      modelId: modelId.slice(separator + 1),
    });
  }

  setThinkingLevel(level: string): Promise<unknown> {
    return this.request({ type: "set_thinking_level", level });
  }

  compact(customInstructions?: string): Promise<unknown> {
    return this.request(
      {
        type: "compact",
        ...(customInstructions ? { customInstructions } : {}),
      },
      0x7fffffff,
    );
  }

  setAutoCompaction(enabled: boolean): Promise<unknown> {
    return this.request({ type: "set_auto_compaction", enabled });
  }

  setSessionName(name: string): Promise<unknown> {
    return this.request({ type: "set_session_name", name });
  }

  respondToInteraction(
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): void {
    this.transport.send({ type: "extension_ui_response", id, ...response });
  }

  stop(): Promise<void> {
    return this.transport.stop();
  }

  private emit(event: PiRpcEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }
}

export function buildPiArgs(launch: PiLaunch): string[] {
  const args = ["--mode", "rpc"];
  if (launch.extraArgs) args.push(...launch.extraArgs);
  if (launch.model) args.push("--model", launch.model);
  if (launch.thinkingOptionId) args.push("--thinking", launch.thinkingOptionId);
  if (launch.noSession) args.push("--no-session");
  if (launch.sessionPath) args.push("--session", launch.sessionPath);
  return args;
}

export function startPi(target: HostTarget, launch: PiLaunch): PiClient {
  const args = buildPiArgs(launch);
  return new PiClient(
    spawnOnHost(target, {
      command: launch.executable,
      args,
      cwd: launch.cwd,
      env: launch.env,
    }),
  );
}
