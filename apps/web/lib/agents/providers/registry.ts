import "server-only";
import type { AgentProviderAdapter } from "@/lib/agents/providers/types";
import { createPiRpcProviderAdapter } from "@/lib/agents/providers/pi-rpc";
import { codexProviderAdapter } from "@/lib/agents/providers/codex";
import type { AgentProviderId } from "@/lib/agents/types";

const adapters = {
  pi: createPiRpcProviderAdapter("pi"),
  omp: createPiRpcProviderAdapter("omp"),
  codex: codexProviderAdapter,
} satisfies Record<AgentProviderId, AgentProviderAdapter>;

export function agentProviderAdapter(
  provider: AgentProviderId,
): AgentProviderAdapter {
  return adapters[provider];
}
