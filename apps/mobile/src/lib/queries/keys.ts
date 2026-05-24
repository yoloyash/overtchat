export const queryKeys = {
  modelConfigs: () => ["modelConfigs"] as const,
  chats: () => ["chats"] as const,
  chatMessages: (id: string) => ["chat", id, "messages"] as const,
  search: (q: string) => ["search", q] as const,
};
