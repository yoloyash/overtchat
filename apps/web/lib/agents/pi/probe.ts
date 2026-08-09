import "server-only";
import type { ConnectorShellMode } from "@overtchat/agent-bridge";
import type {
  AgentConnectionDraft,
  AgentConnectionProbe,
  AgentProviderId,
  AgentReadyConnectionProbe,
} from "@/lib/agents/types";
import { agentProviderMetadata } from "@/lib/agents/catalog";
import {
  parseAgentVersion,
  shellModesForTarget,
  targetForConnectionDraft,
  targetWithShellMode,
} from "@/lib/agents/runtime/discovery";
import {
  executeOnHost,
  type HostTarget,
} from "@/lib/agents/runtime/process";
import { startPiRpc } from "@/lib/agents/pi/client";

const MODEL_PROBE_TIMEOUT_MS = 120_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function probeAgentConnection(
  draft: AgentConnectionDraft,
): Promise<AgentConnectionProbe> {
  return probeAgentTarget(
    targetForConnectionDraft(draft),
    draft.provider,
    draft.executable,
  );
}

export async function probeAgentTarget(
  target: HostTarget,
  provider: AgentProviderId,
  executable: string,
): Promise<AgentReadyConnectionProbe> {
  const metadata = agentProviderMetadata(provider);
  let resolved:
    | {
        target: HostTarget;
        shellMode: ConnectorShellMode;
        version: string;
      }
    | undefined;
  const failures: string[] = [];
  for (const shellMode of shellModesForTarget(target)) {
    try {
      const resolvedTarget = targetWithShellMode(target, shellMode);
      const versionResult = await executeOnHost(resolvedTarget, {
        command: executable,
        args: ["--version"],
      });
      const version = parseAgentVersion(versionResult.stdout);
      if (!version) {
        throw new Error(`${metadata.label} returned an invalid version.`);
      }
      resolved = { target: resolvedTarget, shellMode, version };
      break;
    } catch (error) {
      failures.push(
        `${shellMode === "interactive" ? "Interactive login" : "Login"}: ${errorMessage(error)}`,
      );
    }
  }
  if (!resolved) {
    throw new Error(
      `${metadata.label} could not be started. ${failures.join(" ")}`,
    );
  }

  const client = startPiRpc(resolved.target, {
    provider,
    executable,
    noSession: true,
    extraArgs: [
      "--no-extensions",
      "--no-skills",
      ...(provider === "pi"
        ? ["--no-prompt-templates", "--no-context-files"]
        : ["--no-rules"]),
    ],
  });
  try {
    await client.getState();
    const models = await client.getAvailableModels(MODEL_PROBE_TIMEOUT_MS);
    if (models.length === 0) {
      throw new Error(
        `${metadata.label} is installed, but it did not report any usable models.`,
      );
    }
    return {
      status: "ready",
      version: resolved.version,
      models,
      shellMode: resolved.shellMode,
    };
  } finally {
    await client.stop();
  }
}

export function probePiConnection(
  draft: AgentConnectionDraft,
): Promise<AgentConnectionProbe> {
  return probeAgentConnection(draft);
}

export function probePiTarget(
  target: HostTarget,
  executable: string,
): Promise<AgentReadyConnectionProbe> {
  return probeAgentTarget(target, "pi", executable);
}
