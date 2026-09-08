export const queryKeys = {
  agentConnections: (server: string) =>
    ["agents", server, "connections"] as const,
  agentSession: (server: string, id: string) =>
    ["agents", server, "session", id] as const,
  agentCatalog: (server: string, workspace: string, provider: string) =>
    ["agents", server, "catalog", workspace, provider] as const,
  agentGitStatus: (server: string, workspace: string) =>
    ["agents", server, "git-status", workspace] as const,
  modelConfigs: () => ["modelConfigs"] as const,
  chats: () => ["chats"] as const,
  chatMessages: (id: string) => ["chat", id, "messages"] as const,
  search: (q: string) => ["search", q] as const,
  projects: () => ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  personalization: () => ["personalization"] as const,
};
