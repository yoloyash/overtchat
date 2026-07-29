import "server-only";
import { createOpenAICompatibleAdapter } from "@/lib/providers/server/adapters/openai-compatible";

export const vllmAdapter = createOpenAICompatibleAdapter("vllm");
