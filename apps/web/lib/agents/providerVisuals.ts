import type { AgentProviderId } from "@overtchat/agent-bridge";

export type AgentProviderVisual = {
  /** Served from `public/agent-providers`. */
  icon: string;
  darkSurface?: boolean;
};

export const AGENT_PROVIDER_VISUALS: Record<
  AgentProviderId,
  AgentProviderVisual
> = {
  pi: { icon: "/agent-providers/pi.svg" },
  omp: { icon: "/agent-providers/omp.svg", darkSurface: true },
  codex: { icon: "/agent-providers/codex.png", darkSurface: true },
  opencode: { icon: "/agent-providers/opencode.svg", darkSurface: true },
  claude: { icon: "/agent-providers/claude-code.png" },
  hermes: { icon: "/agent-providers/hermes.png" },
};
