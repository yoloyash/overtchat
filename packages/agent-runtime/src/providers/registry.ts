import type { AgentProviderAdapter } from "@overtchat/agent-runtime/providers/types";
import { piProviderAdapter } from "@overtchat/agent-runtime/providers/pi";
import { ompProviderAdapter } from "@overtchat/agent-runtime/providers/omp";
import { codexProviderAdapter } from "@overtchat/agent-runtime/providers/codex";
import type { AgentProviderId } from "@overtchat/agent-bridge";

const adapters = {
  pi: piProviderAdapter,
  omp: ompProviderAdapter,
  codex: codexProviderAdapter,
} satisfies Record<AgentProviderId, AgentProviderAdapter>;

export function agentProviderAdapter(
  provider: AgentProviderId,
): AgentProviderAdapter {
  return adapters[provider];
}
