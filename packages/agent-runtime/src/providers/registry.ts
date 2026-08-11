import type { AgentProviderAdapter } from "@overtchat/agent-runtime/providers/types";
import { createPiRpcProviderAdapter } from "@overtchat/agent-runtime/providers/pi-rpc";
import { codexProviderAdapter } from "@overtchat/agent-runtime/providers/codex";
import type { AgentProviderId } from "@overtchat/agent-bridge";

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
