import "server-only";
import type { ConnectorShellMode } from "@overtchat/agent-bridge";
import { AGENT_PROVIDERS } from "@/lib/agents/catalog";
import type {
  AgentConnectionDraft,
  DetectedAgentInstallation,
  AgentProviderId,
} from "@/lib/agents/types";
import {
  executeOnHost,
  type HostTarget,
} from "@/lib/agents/runtime/process";

const AGENT_SHELL_MODES = [
  "interactive",
  "login",
] as const satisfies readonly ConnectorShellMode[];

const EXECUTABLE_DISCOVERY = String.raw`
for candidate do
  resolved=$(command -v "$candidate" 2>/dev/null) || continue
  case "$resolved" in
    /*) printf '%s\0%s\0' "$candidate" "$resolved" ;;
  esac
done
`.trim();

export function parseAgentVersion(output: string): string | null {
  return output.match(/\d+\.\d+\.\d+(?:[-+][^\s]+)?/u)?.[0] ?? null;
}

export function shellModesForTarget(
  target: HostTarget,
): ConnectorShellMode[] {
  if (!target.shellMode) return [...AGENT_SHELL_MODES];
  return [
    target.shellMode,
    ...AGENT_SHELL_MODES.filter((mode) => mode !== target.shellMode),
  ];
}

export function targetWithShellMode(
  target: HostTarget,
  shellMode: ConnectorShellMode,
): HostTarget {
  return { ...target, shellMode };
}

export function targetForConnectionDraft(
  draft: AgentConnectionDraft,
): HostTarget {
  if (draft.transport === "local") {
    return { connectorId: draft.connectorId, transport: "local" };
  }
  return {
    connectorId: draft.connectorId,
    transport: "ssh",
    alias: draft.sshAlias,
  };
}

async function discoverAgentInstallationsInMode(
  target: HostTarget,
  shellMode: ConnectorShellMode,
): Promise<DetectedAgentInstallation[]> {
  const resolvedTarget = targetWithShellMode(target, shellMode);
  const providers = Object.values(AGENT_PROVIDERS);
  const result = await executeOnHost(resolvedTarget, {
    command: "/bin/sh",
    args: [
      "-c",
      EXECUTABLE_DISCOVERY,
      "overtchat-agent-discovery",
      ...providers.map(({ executable }) => executable),
    ],
  });
  const fields = result.stdout.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const resolved = new Map<string, string>();
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const command = fields[index];
    const executable = fields[index + 1];
    if (
      command &&
      executable?.startsWith("/") &&
      executable.length <= 500
    ) {
      resolved.set(command, executable);
    }
  }

  const installations = await Promise.all(
    providers.map(async ({ id, executable: command }) => {
      const executable = resolved.get(command);
      if (!executable) return null;
      try {
        const versionResult = await executeOnHost(resolvedTarget, {
          command: executable,
          args: ["--version"],
        });
        const version = parseAgentVersion(versionResult.stdout);
        return version ? { provider: id, executable, version } : null;
      } catch {
        return null;
      }
    }),
  );
  return installations.filter(
    (installation): installation is DetectedAgentInstallation =>
      installation !== null,
  );
}

export async function discoverAgentInstallations(
  target: HostTarget,
): Promise<DetectedAgentInstallation[]> {
  const providers = Object.values(AGENT_PROVIDERS);
  const found = new Map<AgentProviderId, DetectedAgentInstallation>();
  let successfulMode = false;
  let firstError: unknown;

  for (const shellMode of shellModesForTarget(target)) {
    try {
      const installations = await discoverAgentInstallationsInMode(
        target,
        shellMode,
      );
      successfulMode = true;
      for (const installation of installations) {
        if (!found.has(installation.provider)) {
          found.set(installation.provider, installation);
        }
      }
      if (found.size === providers.length) break;
    } catch (error) {
      firstError ??= error;
    }
  }

  if (!successfulMode && firstError) throw firstError;
  return providers.flatMap(({ id }) => {
    const installation = found.get(id);
    return installation ? [installation] : [];
  });
}
