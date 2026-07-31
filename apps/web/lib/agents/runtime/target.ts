import "server-only";
import type { AgentHostRow } from "@/lib/db/agentConnections";
import { decryptAgentCredential } from "@/lib/agents/runtime/credentials";
import type { HostTarget } from "@/lib/agents/runtime/process";

export function targetForStoredHost(host: AgentHostRow): HostTarget {
  if (host.transport === "local") return { transport: "local" };
  if (
    !host.hostname ||
    !host.port ||
    !host.username ||
    !host.hostKey ||
    !host.sshAuth
  ) {
    throw new Error("The saved SSH connection is incomplete.");
  }
  let privateKey: string | undefined;
  if (host.sshAuth === "private_key") {
    if (!host.encryptedCredential) {
      throw new Error("The saved SSH private key is missing.");
    }
    privateKey = decryptAgentCredential(host.encryptedCredential);
  }
  return {
    transport: "ssh",
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    hostKey: host.hostKey,
    ...(privateKey ? { privateKey } : {}),
  };
}
