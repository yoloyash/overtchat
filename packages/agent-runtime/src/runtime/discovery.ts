import type { ConnectorShellMode } from "@overtchat/agent-bridge";
import { AGENT_PROVIDERS, isAbsoluteAgentPath } from "@overtchat/agent-bridge";
import { WINDOWS_COMMAND_SCRIPT } from "./windows-command";
import type {
  AgentConnectionDraft,
  AgentDiscoveryTarget,
  DetectedAgentInstallation,
  AgentProviderId,
} from "@overtchat/agent-bridge";
import {
  executeOnHost,
  inspectHostEnvironment,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

const AGENT_SHELL_MODES = [
  "interactive",
  "login",
] as const satisfies readonly ConnectorShellMode[];

const WINDOWS_DISCOVERY_SCRIPT = `${WINDOWS_COMMAND_SCRIPT}
Promise.all(process.argv.slice(1).map(candidate => new Promise(resolve => {
  let launch;
  try { launch = commandLaunch(candidate, ['--version']); } catch { resolve(); return; }
  const child = cp.spawn(launch.command, launch.args, { windowsHide: true, windowsVerbatimArguments: launch.windowsVerbatimArguments });
  let output = ''; let overflow = false;
  const append = chunk => { if (output.length < 65536) output += chunk.toString(); else overflow = true; };
  child.stdout.on('data', append); child.stderr.on('data', append); child.stdin.end();
  const timer = setTimeout(() => {
    if (child.pid) cp.spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 2000 });
    resolve();
  }, 8000);
  child.on('error', () => { clearTimeout(timer); resolve(); });
  child.on('close', code => {
    clearTimeout(timer);
    if (code === 0 && !overflow) process.stdout.write(candidate + '\\0' + resolveCommand(candidate) + '\\0' + output + '\\0');
    resolve();
  });
}))).catch(error => { console.error(error.message); process.exitCode = 1; });
`;

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

export function shellModesForTarget(target: HostTarget): ConnectorShellMode[] {
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
  windows = false,
): Promise<DetectedAgentInstallation[]> {
  const resolvedTarget = targetWithShellMode(target, shellMode);
  const providers = Object.values(AGENT_PROVIDERS);
  const result = await executeOnHost(
    resolvedTarget,
    windows
      ? {
          command: "node",
          args: [
            "-e",
            WINDOWS_DISCOVERY_SCRIPT,
            ...providers.map(({ executable }) => executable),
          ],
        }
      : {
          command: "/bin/sh",
          args: [
            "-c",
            AGENT_INSTALLATION_DISCOVERY_SCRIPT,
            "overtchat-agent-discovery",
            ...providers.map(({ executable }) => executable),
          ],
        },
  );
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
      executable &&
      isAbsoluteAgentPath(executable) &&
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
  if ((await inspectHostEnvironment(target)).platform === "win32") {
    return discoverAgentInstallationsInMode(target, "login", true);
  }
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
