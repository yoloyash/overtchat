export const queryKeys = {
  modelConfigs: () => ["modelConfigs"] as const,
  toolCapabilities: () => ["tools", "capabilities"] as const,
  chats: () => ["chats"] as const,
  chatMessages: (id: string) => ["chat", id, "messages"] as const,
  search: (q: string) => ["search", q] as const,
  projects: () => ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
};
