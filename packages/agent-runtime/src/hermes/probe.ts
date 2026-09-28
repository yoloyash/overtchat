import type {
  AgentConnectionDraft,
  AgentReadyConnectionProbe,
} from "@overtchat/agent-bridge";
import {
  parseAgentVersion,
  shellModesForTarget,
  targetForConnectionDraft,
  targetWithShellMode,
} from "../runtime/discovery";
import { executeOnHost, type HostTarget } from "../runtime/process";
import { startHermesRuntime } from "./client";

export async function probeHermesTarget(
  target: HostTarget,
  executable: string,
): Promise<AgentReadyConnectionProbe> {
  const failures: string[] = [];
  for (const shellMode of shellModesForTarget(target)) {
    const resolved = targetWithShellMode(target, shellMode);
    try {
      const versionResult = await executeOnHost(resolved, {
        command: executable,
        args: ["acp", "--version"],
      });
      const version = parseAgentVersion(versionResult.stdout);
      if (!version) throw new Error("Hermes did not report an ACP version.");
      await executeOnHost(resolved, {
        command: executable,
        args: ["acp", "--check"],
      });
      const cwd = (
        await executeOnHost(resolved, { command: "/bin/pwd" })
      ).stdout.trim();
      const client = startHermesRuntime(resolved, {
        executable,
        cwd: cwd || "/",
      });
      try {
        const models = await client.getAvailableModels();
        if (!models.length)
          throw new Error(
            "Hermes did not report any models. Configure credentials with hermes model on this host.",
          );
        return { status: "ready", version, models, shellMode };
      } finally {
        await client.stop();
      }
    } catch (error) {
      failures.push(
        `${shellMode}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `Hermes ACP is unavailable. Install Hermes with its ACP dependencies and run hermes model on the execution host. ${failures.join(" ")}`,
  );
}

export function probeHermesConnection(
  draft: AgentConnectionDraft,
): Promise<AgentReadyConnectionProbe> {
  return probeHermesTarget(targetForConnectionDraft(draft), draft.executable);
}
