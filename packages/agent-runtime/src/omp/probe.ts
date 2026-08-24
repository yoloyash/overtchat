import type {
  AgentConnectionDraft,
  AgentConnectionProbe,
  AgentReadyConnectionProbe,
  ConnectorShellMode,
} from "@overtchat/agent-bridge";
import { startOmp } from "@overtchat/agent-runtime/omp/client";
import {
  parseAgentVersion,
  shellModesForTarget,
  targetForConnectionDraft,
  targetWithShellMode,
} from "@overtchat/agent-runtime/runtime/discovery";
import { executeOnHost, type HostTarget } from "@overtchat/agent-runtime/runtime/process";

const MODEL_PROBE_TIMEOUT_MS = 120_000;

export async function probeOmpTarget(
  target: HostTarget,
  executable: string,
): Promise<AgentReadyConnectionProbe> {
  let resolved: { target: HostTarget; shellMode: ConnectorShellMode; version: string } | undefined;
  const failures: string[] = [];
  for (const shellMode of shellModesForTarget(target)) {
    try {
      const resolvedTarget = targetWithShellMode(target, shellMode);
      const result = await executeOnHost(resolvedTarget, { command: executable, args: ["--version"] });
      const version = parseAgentVersion(result.stdout);
      if (!version) throw new Error("Oh My Pi returned an invalid version.");
      resolved = { target: resolvedTarget, shellMode, version };
      break;
    } catch (error) {
      failures.push(`${shellMode === "interactive" ? "Interactive login" : "Login"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!resolved) throw new Error(`Oh My Pi could not be started. ${failures.join(" ")}`);
  const client = startOmp(resolved.target, {
    executable,
    noSession: true,
    modeId: "full",
    extraArgs: ["--no-extensions", "--no-skills", "--no-rules"],
  });
  try {
    await client.getState();
    const models = await client.getAvailableModels(MODEL_PROBE_TIMEOUT_MS);
    if (!models.length) throw new Error("Oh My Pi is installed, but it did not report any usable models.");
    return { status: "ready", version: resolved.version, models, shellMode: resolved.shellMode };
  } finally {
    await client.stop();
  }
}

export function probeOmpConnection(draft: AgentConnectionDraft): Promise<AgentConnectionProbe> {
  return probeOmpTarget(targetForConnectionDraft(draft), draft.executable);
}
