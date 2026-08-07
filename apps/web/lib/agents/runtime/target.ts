import "server-only";
import type { AgentHostRow } from "@/lib/db/agentConnections";
import type { HostTarget } from "@/lib/agents/runtime/process";

export function targetForStoredHost(host: AgentHostRow): HostTarget {
  if (host.transport === "local") {
    return { connectorId: host.connectorId, transport: "local" };
  }
  if (!host.sshAlias) throw new Error("The saved SSH alias is missing.");
  return {
    connectorId: host.connectorId,
    transport: "ssh",
    alias: host.sshAlias,
  };
}
