import type { AgentProviderId } from "@/lib/agents/types";
import { agentProviderMetadata } from "@/lib/agents/catalog";

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
  if (
    /incorrect passphrase|encrypted private key|passphrase.*private key/i.test(
      message,
    )
  ) {
    return "Encrypted SSH private keys are not supported yet. Use an unencrypted key for this connection.";
  }
  if (/permission denied.*publickey|authentication failed/i.test(message)) {
    return "SSH authentication failed. Check the username and private key.";
  }
  return message || "The agent connection failed.";
}
