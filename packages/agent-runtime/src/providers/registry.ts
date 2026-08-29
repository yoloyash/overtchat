import type { AgentProviderAdapter } from "@overtchat/agent-runtime/providers/types";
import { piProviderAdapter } from "@overtchat/agent-runtime/providers/pi";
import { ompProviderAdapter } from "@overtchat/agent-runtime/providers/omp";
import { codexProviderAdapter } from "@overtchat/agent-runtime/providers/codex";
import { openCodeProviderAdapter } from "@overtchat/agent-runtime/providers/opencode";
import { claudeProviderAdapter } from "@overtchat/agent-runtime/providers/claude";
import type { AgentProviderId } from "@overtchat/agent-bridge";

const adapters = {
  pi: piProviderAdapter,
  omp: ompProviderAdapter,
  codex: codexProviderAdapter,
  opencode: openCodeProviderAdapter,
  claude: claudeProviderAdapter,
} satisfies Record<AgentProviderId, AgentProviderAdapter>;

export function agentProviderAdapter(
  provider: AgentProviderId,
): AgentProviderAdapter {
  return adapters[provider];
}
