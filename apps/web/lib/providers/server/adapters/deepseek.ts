import "server-only";
import { createOpenAICompatibleAdapter } from "@/lib/providers/server/adapters/openai-compatible";

export const deepSeekAdapter = createOpenAICompatibleAdapter("deepseek");
