import type {
  AgentConnectionDraft,
  AgentReadyConnectionProbe,
  ConnectorShellMode,
} from "@overtchat/agent-bridge";
import { fetchOpenCodeCatalog } from "@overtchat/agent-runtime/opencode/client";
import {
  parseAgentVersion,
  shellModesForTarget,
  targetForConnectionDraft,
  targetWithShellMode,
} from "@overtchat/agent-runtime/runtime/discovery";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

export async function probeOpenCodeTarget(
  target: HostTarget,
  executable: string,
): Promise<AgentReadyConnectionProbe> {
  let resolved:
    | { target: HostTarget; shellMode: ConnectorShellMode; version: string }
    | undefined;
  const failures: string[] = [];
  for (const shellMode of shellModesForTarget(target)) {
    try {
      const resolvedTarget = targetWithShellMode(target, shellMode);
      const result = await executeOnHost(resolvedTarget, {
        command: executable,
        args: ["--version"],
      });
      const version = parseAgentVersion(result.stdout);
      if (!version) throw new Error("OpenCode returned an invalid version.");
      resolved = { target: resolvedTarget, shellMode, version };
      break;
    } catch (error) {
      failures.push(
        `${shellMode === "interactive" ? "Interactive login" : "Login"}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (!resolved) {
    throw new Error(`OpenCode could not be started. ${failures.join(" ")}`);
  }
  const catalog = await fetchOpenCodeCatalog(
    resolved.target,
    executable,
  );
  if (!catalog.models.length) {
    throw new Error("OpenCode is installed, but it did not report any usable models.");
  }
  return {
    status: "ready",
    version: resolved.version,
    models: catalog.models,
    shellMode: resolved.shellMode,
  };
}

export function probeOpenCodeConnection(
  draft: AgentConnectionDraft,
): Promise<AgentReadyConnectionProbe> {
  return probeOpenCodeTarget(
    targetForConnectionDraft(draft),
    draft.executable,
  );
}
