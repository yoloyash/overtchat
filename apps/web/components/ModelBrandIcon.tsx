"use client";

import type { ModelBrandIconId } from "@overtchat/shared";
import anthropic from "@lobehub/icons-static-svg/icons/anthropic.svg";
import claude from "@lobehub/icons-static-svg/icons/claude.svg";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek.svg";
import gemini from "@lobehub/icons-static-svg/icons/gemini.svg";
import groq from "@lobehub/icons-static-svg/icons/groq.svg";
import meta from "@lobehub/icons-static-svg/icons/meta.svg";
import minimax from "@lobehub/icons-static-svg/icons/minimax.svg";
import mistral from "@lobehub/icons-static-svg/icons/mistral.svg";
import ollama from "@lobehub/icons-static-svg/icons/ollama.svg";
import openai from "@lobehub/icons-static-svg/icons/openai.svg";
import openrouter from "@lobehub/icons-static-svg/icons/openrouter.svg";
import qwen from "@lobehub/icons-static-svg/icons/qwen.svg";
import vllm from "@lobehub/icons-static-svg/icons/vllm.svg";
import { cn } from "@/lib/utils";

type IconAsset = string | { src: string };

const ICONS = {
  anthropic,
  claude,
  deepseek,
  gemini,
  groq,
  meta,
  minimax,
  mistral,
  ollama,
  openai,
  openrouter,
  qwen,
  vllm,
} satisfies Record<ModelBrandIconId, IconAsset>;

const LABELS = {
  anthropic: "Anthropic",
  claude: "Claude",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  groq: "Groq",
  meta: "Meta",
  minimax: "MiniMax",
  mistral: "Mistral",
  ollama: "Ollama",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  qwen: "Qwen",
  vllm: "vLLM",
} satisfies Record<ModelBrandIconId, string>;

export function ModelBrandIcon({
  iconId,
  className,
  title,
}: {
  iconId: ModelBrandIconId | null | undefined;
  className?: string;
  title?: string;
}) {
  if (!iconId) return null;
  const src = ICONS[iconId];
  if (!src) return null;
  const url = typeof src === "string" ? src : src.src;

  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-4 shrink-0 bg-current text-muted-foreground",
        className,
      )}
      style={{
        maskImage: `url("${url}")`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url("${url}")`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
      title={title ?? LABELS[iconId]}
    />
  );
}
