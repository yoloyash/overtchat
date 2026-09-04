export const chatKeys = {
  all: () => ["chats"] as const,
  list: () => [...chatKeys.all(), "list"] as const,
  active: () => [...chatKeys.all(), "active"] as const,
  detail: (id: string) => [...chatKeys.all(), "detail", id] as const,
  usage: (id: string) => [...chatKeys.detail(id), "usage"] as const,
};

export const projectKeys = {
  all: () => ["projects"] as const,
  list: () => [...projectKeys.all(), "list"] as const,
  detail: (id: string) => [...projectKeys.all(), "detail", id] as const,
};

export const agentConnectionKeys = {
  all: () => ["agentConnections"] as const,
  list: () => [...agentConnectionKeys.all(), "list"] as const,
  connectors: () => [...agentConnectionKeys.all(), "connectors"] as const,
  sshHosts: (connectorId: string) =>
    [...agentConnectionKeys.all(), "sshHosts", connectorId] as const,
  discovery: (
    connectorId: string,
    transport: "local" | "ssh",
    sshAlias: string,
  ) =>
    [
      ...agentConnectionKeys.all(),
      "discovery",
      connectorId,
      transport,
      sshAlias,
    ] as const,
  providerSnapshot: (
    connectorId: string,
    transport: "local" | "ssh",
    sshAlias: string,
  ) =>
    [
      ...agentConnectionKeys.all(),
      "providerSnapshot",
      connectorId,
      transport,
      sshAlias,
    ] as const,
  targetDirectories: (
    connectorId: string,
    transport: "local" | "ssh",
    sshAlias: string,
    path: string,
  ) =>
    [
      ...agentConnectionKeys.all(),
      "targetDirectories",
      connectorId,
      transport,
      sshAlias,
      path,
    ] as const,
  catalog: (workspaceId: string, provider: string) =>
    [...agentConnectionKeys.all(), "catalog", workspaceId, provider] as const,
};

export const agentSessionKeys = {
  all: () => ["agentSessions"] as const,
  detail: (id: string) =>
    [...agentSessionKeys.all(), "detail", id] as const,
};

export const agentWorkspaceKeys = {
  all: () => ["agentWorkspaces"] as const,
  gitStatus: (id: string) =>
    [...agentWorkspaceKeys.all(), "gitStatus", id] as const,
  directories: (id: string) =>
    [...agentWorkspaceKeys.all(), "directory", id] as const,
  directory: (id: string, path: string) =>
    [...agentWorkspaceKeys.directories(id), path] as const,
  file: (id: string, path: string) =>
    [...agentWorkspaceKeys.all(), "file", id, path] as const,
};

export const modelConfigKeys = {
  all: () => ["modelConfigs"] as const,
  publicList: () => [...modelConfigKeys.all(), "list", "public"] as const,
  adminList: () => [...modelConfigKeys.all(), "list", "admin"] as const,
  health: (id: string) => [...modelConfigKeys.all(), "health", id] as const,
};

export const mcpServerKeys = {
  all: () => ["mcpServers"] as const,
  adminList: () => [...mcpServerKeys.all(), "list", "admin"] as const,
  availableList: () => [...mcpServerKeys.all(), "list", "available"] as const,
  health: (id: string) => [...mcpServerKeys.all(), "health", id] as const,
};

export const serverCapabilityKeys = {
  all: () => ["serverCapabilities"] as const,
  list: () => [...serverCapabilityKeys.all(), "list"] as const,
};

export const userKeys = {
  all: () => ["users"] as const,
  list: () => [...userKeys.all(), "list"] as const,
};

export const personalizationKeys = {
  all: () => ["personalization"] as const,
  detail: () => [...personalizationKeys.all(), "detail"] as const,
};

export const activityKeys = {
  all: () => ["activity"] as const,
  leaderboard: (period: string) =>
    [...activityKeys.all(), "leaderboard", period] as const,
  profile: (userId: string, timeZone: string) =>
    [...activityKeys.all(), "profile", userId, timeZone] as const,
};

export const searchKeys = {
  all: () => ["search"] as const,
  byQuery: (q: string) => [...searchKeys.all(), q] as const,
};

export const appUpdateKeys = {
  all: () => ["appUpdate"] as const,
  status: () => [...appUpdateKeys.all(), "status"] as const,
};
