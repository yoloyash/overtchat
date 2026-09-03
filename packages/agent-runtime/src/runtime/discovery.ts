import type { ConnectorShellMode } from "@overtchat/agent-bridge";
import { AGENT_PROVIDERS } from "@overtchat/agent-bridge";
import type {
  AgentConnectionDraft,
  AgentDiscoveryTarget,
  DetectedAgentInstallation,
  AgentProviderId,
} from "@overtchat/agent-bridge";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

const AGENT_SHELL_MODES = [
  "interactive",
  "login",
] as const satisfies readonly ConnectorShellMode[];

export const AGENT_INSTALLATION_DISCOVERY_SCRIPT = String.raw`
set -u
directory=$(mktemp -d "${"$"}{TMPDIR:-/tmp}/overtchat-agent-discovery.XXXXXX") || exit 1
cleanup() { rm -rf -- "$directory"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
i=0
for candidate do
  resolved=$(command -v "$candidate" 2>/dev/null) || continue
  case "$resolved" in
    /*)
      printf '%s\0%s\0' "$candidate" "$resolved" > "$directory/meta.$i"
      "$resolved" --version > "$directory/version.$i" 2>&1 &
      printf '%s' "$!" > "$directory/pid.$i"
      i=$((i + 1))
      ;;
  esac
done

ticks=0
while [ "$ticks" -lt 100 ]; do
  running=0
  for pid_file in "$directory"/pid.*; do
    [ -f "$pid_file" ] || continue
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      running=1
      break
    fi
  done
  [ "$running" -eq 0 ] && break
  sleep 0.1
  ticks=$((ticks + 1))
done

for pid_file in "$directory"/pid.*; do
  [ -f "$pid_file" ] || continue
  index=${"$"}{pid_file##*.}
  pid=$(cat "$pid_file")
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.1
    kill -KILL "$pid" 2>/dev/null || true
  fi
  if wait "$pid"; then
    {
      cat "$directory/meta.$index"
      cat "$directory/version.$index"
      printf '\0'
    } > "$directory/result.$index"
  fi
done
for file in "$directory"/result.*; do
  [ -f "$file" ] || continue
  cat "$file"
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
    return { transport: "local" };
  }
  return {
    transport: "ssh",
    alias: draft.sshAlias,
  };
}

export function targetForDiscovery(target: AgentDiscoveryTarget): HostTarget {
  return target.transport === "local"
    ? { transport: "local" }
    : { transport: "ssh", alias: target.sshAlias };
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
      AGENT_INSTALLATION_DISCOVERY_SCRIPT,
      "overtchat-agent-discovery",
      ...providers.map(({ executable }) => executable),
    ],
  });
  const fields = result.stdout.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const installations = new Map<AgentProviderId, DetectedAgentInstallation>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const command = fields[index];
    const executable = fields[index + 1];
    const versionOutput = fields[index + 2];
    const provider = providers.find(
      (candidate) => candidate.executable === command,
    );
    const version = parseAgentVersion(versionOutput ?? "");
    if (
      provider &&
      executable?.startsWith("/") &&
      executable.length <= 500 &&
      version
    ) {
      installations.set(provider.id, {
        provider: provider.id,
        executable,
        version,
        shellMode,
      });
    }
  }
  return providers.flatMap(({ id }) => {
    const installation = installations.get(id);
    return installation ? [installation] : [];
  });
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
