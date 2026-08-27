import type { StaticImageData } from "next/image";
import codexIcon from "@/assets/agent-providers/codex.png";
import ompIcon from "@/assets/agent-providers/omp.svg";
import openCodeIcon from "@/assets/agent-providers/opencode.svg";
import piIcon from "@/assets/agent-providers/pi.svg";
import type { AgentProviderId } from "@overtchat/agent-bridge";

export type AgentProviderVisual = {
  icon: StaticImageData;
  darkSurface?: boolean;
};

export const AGENT_PROVIDER_VISUALS: Record<
  AgentProviderId,
  AgentProviderVisual
> = {
  pi: { icon: piIcon },
  omp: { icon: ompIcon, darkSurface: true },
  codex: { icon: codexIcon, darkSurface: true },
  opencode: { icon: openCodeIcon, darkSurface: true },
};
