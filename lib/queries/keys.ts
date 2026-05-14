export const chatKeys = {
  all: () => ["chats"] as const,
  list: () => [...chatKeys.all(), "list"] as const,
  detail: (id: string) => [...chatKeys.all(), "detail", id] as const,
};

export const projectKeys = {
  all: () => ["projects"] as const,
  list: () => [...projectKeys.all(), "list"] as const,
  detail: (id: string) => [...projectKeys.all(), "detail", id] as const,
};

export const modelConfigKeys = {
  all: () => ["modelConfigs"] as const,
  publicList: () => [...modelConfigKeys.all(), "list", "public"] as const,
  adminList: () => [...modelConfigKeys.all(), "list", "admin"] as const,
};

export const userKeys = {
  all: () => ["users"] as const,
  list: () => [...userKeys.all(), "list"] as const,
};

export const searchKeys = {
  all: () => ["search"] as const,
  byQuery: (q: string) => [...searchKeys.all(), q] as const,
};
