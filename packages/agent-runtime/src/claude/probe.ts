import type {
  AgentConnectionDraft,
  AgentConnectionProbe,
  AgentReadyConnectionProbe,
  ConnectorShellMode,
} from "@overtchat/agent-bridge";
import { startClaudeRuntime } from "@overtchat/agent-runtime/claude/client";
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

export async function probeClaudeTarget(
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
      const version = parseAgentVersion(`${result.stdout}\n${result.stderr}`);
      if (!version) throw new Error("Claude Code returned an invalid version.");
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
    throw new Error(`Claude Code could not be started. ${failures.join(" ")}`);
  }
  const authResult = await executeOnHost(resolved.target, {
    command: executable,
    args: ["auth", "status", "--json"],
  });
  let authenticated = false;
  try {
    const status = JSON.parse(authResult.stdout) as Record<string, unknown>;
    authenticated = status.loggedIn === true;
  } catch {
    // The explicit error below is clearer than surfacing JSON parser details.
  }
  if (!authenticated) {
    throw new Error(
      "Claude Code is installed but not authenticated on this execution target.",
    );
  }
  const remoteCwd = (
    await executeOnHost(resolved.target, { command: "/bin/pwd" })
  ).stdout.trim();
  const client = startClaudeRuntime(resolved.target, {
    executable,
    cwd: remoteCwd || "/",
    modeId: "default",
  });
  try {
    await client.getState();
    const models = await client.getAvailableModels();
    if (!models.length) {
      throw new Error("Claude Code did not report any usable models.");
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

export function probeClaudeConnection(
  draft: AgentConnectionDraft,
): Promise<AgentConnectionProbe> {
  return probeClaudeTarget(targetForConnectionDraft(draft), draft.executable);
}
