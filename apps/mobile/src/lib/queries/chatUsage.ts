import { useQuery } from "@tanstack/react-query";
import type { ChatUsageResponse } from "@overtchat/shared/usage";
import { queryKeys } from "@/lib/queries/keys";
import { settingsRequest } from "@/lib/queries/settings";

/** Recorded token and cost totals for a persisted chat. */
export function useChatUsageTotals(chatId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.chatUsage(chatId),
    queryFn: () => settingsRequest<ChatUsageResponse>(`/chat/${chatId}/usage`),
    enabled,
    retry: false,
  });
}
