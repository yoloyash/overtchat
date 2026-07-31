import type { AgentConnectionDraft } from "@/lib/agents/types";
import type { AgentHostRow } from "@/lib/db/agentConnections";

export function connectionAccessError(
  role: string | null | undefined,
  draft: AgentConnectionDraft,
): string | null {
  if (role === "admin") return null;
  if (draft.transport === "local") {
    return "Only an administrator can run coding agents on the OvertChat server.";
  }
  if (draft.sshAuth === "agent") {
    return "Only an administrator can use the OvertChat server's SSH agent. Choose a private key instead.";
  }
  return null;
}

export function storedConnectionAccessError(
  role: string | null | undefined,
  host: AgentHostRow,
): string | null {
  if (role === "admin") return null;
  if (host.transport === "local") {
    return "Only an administrator can run coding agents on the OvertChat server.";
  }
  if (host.sshAuth === "agent") {
    return "Only an administrator can use the OvertChat server's SSH agent.";
  }
  return null;
}

export function connectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /\bENOENT\b/u.test(message) ||
    /not found|command not found|no such file/i.test(message)
  ) {
    return "Pi installation not found. Check the executable path and try again.";
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
