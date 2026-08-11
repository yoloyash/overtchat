import type { ConnectorShellMode } from "@overtchat/agent-bridge";
import type {
  AgentConnectionDraft,
  AgentReadyConnectionProbe,
} from "@overtchat/agent-bridge";
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
import { startCodexAppServer } from "@overtchat/agent-runtime/codex/app-server";
import { parseCodexModels, recordOf } from "@overtchat/agent-runtime/codex/protocol";

const MODEL_PROBE_TIMEOUT_MS = 120_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function probeCodexConnection(
  draft: AgentConnectionDraft,
): Promise<AgentReadyConnectionProbe> {
  return probeCodexTarget(
    targetForConnectionDraft(draft),
    draft.executable,
  );
}

export async function probeCodexTarget(
  target: HostTarget,
  executable: string,
): Promise<AgentReadyConnectionProbe> {
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
      if (!version) throw new Error("Codex returned an invalid version.");
      resolved = { target: resolvedTarget, shellMode, version };
      break;
    } catch (error) {
      failures.push(
        `${shellMode === "interactive" ? "Interactive login" : "Login"}: ${errorMessage(error)}`,
      );
    }
  }
  if (!resolved) {
    throw new Error(`Codex could not be started. ${failures.join(" ")}`);
  }

  const server = await startCodexAppServer(resolved.target, executable);
  try {
    await server.ready();
    const [accountResponse, modelResponse] = await Promise.all([
      server.request("account/read", {}),
      server.request(
        "model/list",
        { limit: 200 },
        MODEL_PROBE_TIMEOUT_MS,
      ),
    ]);
    const account = recordOf(accountResponse);
    if (!account?.account && account?.requiresOpenaiAuth === true) {
      throw new Error(
        "Codex is installed but not signed in. Run `codex login` on this machine.",
      );
    }
    const models = parseCodexModels(modelResponse);
    if (models.length === 0) {
      throw new Error(
        "Codex is installed, but it did not report any usable models.",
      );
    }
    return {
      status: "ready",
      version: resolved.version,
      models,
      shellMode: resolved.shellMode,
    };
  } finally {
    await server.stop();
  }
}
