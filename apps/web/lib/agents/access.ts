import type { AgentProviderId } from "@overtchat/agent-bridge";
import { agentProviderMetadata } from "@overtchat/agent-bridge";

export function connectionAccessError(
  role: string | null | undefined,
): string | null {
  if (role === "admin") return null;
  return "Only administrators can use Agent Connections.";
}

export function storedConnectionAccessError(
  role: string | null | undefined,
): string | null {
  return connectionAccessError(role);
}

export function connectionErrorMessage(
  error: unknown,
  provider: AgentProviderId = "pi",
): string {
  const message = error instanceof Error ? error.message : String(error);
  const missingInterpreter =
    /(?:^|\s)(?:\/usr\/bin\/)?env:\s*([^:\s]+):\s*No such file or directory/iu.exec(
      message,
    );
  if (missingInterpreter?.[1]) {
    return `${agentProviderMetadata(provider).label} was found, but ${missingInterpreter[1]} is not available in the selected shell environment.`;
  }
  if (
    /\bENOENT\b/u.test(message) ||
    /not found|command not found|no such file/i.test(message)
  ) {
    return `${agentProviderMetadata(provider).label} installation not found. Check the executable path and try again.`;
  }
  if (/host key verification failed|remote host identification has changed/i.test(message)) {
    return "The remote machine's SSH host key changed. Verify the machine before reconnecting.";
  }
  if (
    /connection refused|no route to host|network is unreachable|connection timed out|timed out while reading the SSH host key/i.test(
      message,
    )
  ) {
    return "The remote machine could not be reached over SSH.";
  }
  if (/permission denied.*publickey|authentication failed/i.test(message)) {
    return "SSH authentication failed. Verify that the alias works non-interactively on the Host Connector machine.";
  }
  return message || "The agent connection failed.";
}
