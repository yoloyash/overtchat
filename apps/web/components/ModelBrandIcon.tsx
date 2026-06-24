"use client";

import Image, { type StaticImageData } from "next/image";
import type { ModelBrandIconId } from "@overtchat/shared";
import anthropic from "@lobehub/icons-static-svg/icons/anthropic.svg";
import claude from "@lobehub/icons-static-svg/icons/claude-color.svg";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import groq from "@lobehub/icons-static-svg/icons/groq.svg";
import meta from "@lobehub/icons-static-svg/icons/meta-color.svg";
import minimax from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg";
import ollama from "@lobehub/icons-static-svg/icons/ollama.svg";
import openai from "@lobehub/icons-static-svg/icons/openai.svg";
import openrouter from "@lobehub/icons-static-svg/icons/openrouter.svg";
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import vllm from "@lobehub/icons-static-svg/icons/vllm-color.svg";
import { cn } from "@/lib/utils";

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
} satisfies Record<ModelBrandIconId, StaticImageData | string>;

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

  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border/60 bg-white text-black",
        className,
      )}
      title={title ?? LABELS[iconId]}
    >
      <Image
        src={src}
        alt=""
        aria-hidden
        width={16}
        height={16}
        className="size-3 object-contain"
        unoptimized
      />
    </span>
  );
}
