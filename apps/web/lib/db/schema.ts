import { relations, sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { UIMessagePart, UIDataTypes, UITools } from "ai";
import type { ModelCapabilities } from "@overtchat/shared";
import {
  API_FORMAT_IDS,
  PROVIDER_IDS,
} from "@/lib/providers/catalog";
import type { ModelPricing } from "@/lib/model-config/schema";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    instructions: text("instructions"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("projects_userId_updatedAt_idx").on(table.userId, table.updatedAt),
  ],
);

export const agentHosts = sqliteTable(
  "agent_hosts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    transport: text("transport", { enum: ["local", "ssh"] }).notNull(),
    hostname: text("hostname"),
    port: integer("port"),
    username: text("username"),
    sshAuth: text("ssh_auth", { enum: ["agent", "private_key"] }),
    encryptedCredential: text("encrypted_credential"),
    hostKey: text("host_key"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("agent_hosts_userId_updatedAt_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
);

export const agentConnections = sqliteTable(
  "agent_connections",
  {
    id: text("id").primaryKey(),
    hostId: text("host_id")
      .notNull()
      .references(() => agentHosts.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    executable: text("executable").notNull(),
    detectedVersion: text("detected_version"),
    lastValidatedAt: integer("last_validated_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_connections_hostId_provider_idx").on(
      table.hostId,
      table.provider,
    ),
  ],
);

export const agentWorkspaces = sqliteTable(
  "agent_workspaces",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => agentConnections.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_workspaces_connectionId_path_idx").on(
      table.connectionId,
      table.path,
    ),
  ],
);

export const agentSessions = sqliteTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => agentWorkspaces.id, { onDelete: "cascade" }),
    providerSessionId: text("provider_session_id").notNull(),
    providerSessionPath: text("provider_session_path").notNull(),
    name: text("name"),
    firstMessage: text("first_message"),
    messageCount: integer("message_count").default(0).notNull(),
    providerCreatedAt: integer("provider_created_at", {
      mode: "timestamp_ms",
    }),
    providerModifiedAt: integer("provider_modified_at", {
      mode: "timestamp_ms",
    }),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_sessions_workspaceId_providerSessionPath_idx").on(
      table.workspaceId,
      table.providerSessionPath,
    ),
    index("agent_sessions_workspaceId_providerModifiedAt_idx").on(
      table.workspaceId,
      table.providerModifiedAt,
    ),
  ],
);

export const chats = sqliteTable(
  "chats",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    title: text("title"),
    activeStreamId: text("active_stream_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("chats_userId_updatedAt_idx").on(table.userId, table.updatedAt),
    index("chats_userId_projectId_updatedAt_idx").on(
      table.userId,
      table.projectId,
      table.updatedAt,
    ),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    parts: text("parts", { mode: "json" })
      .$type<UIMessagePart<UIDataTypes, UITools>[]>()
      .notNull(),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("messages_chatId_createdAt_idx").on(table.chatId, table.createdAt),
  ],
);

export const generationUsage = sqliteTable(
  "generation_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    messageId: text("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    context: text("context", { enum: ["chat", "title"] })
      .default("chat")
      .notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    providerId: text("provider_id").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    uncachedInputTokens: integer("uncached_input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    totalTokens: integer("total_tokens"),
    costSource: text("cost_source", {
      enum: ["models.dev", "model_config"],
    }),
    inputCostNanoUsd: integer("input_cost_nano_usd"),
    outputCostNanoUsd: integer("output_cost_nano_usd"),
    cacheReadCostNanoUsd: integer("cache_read_cost_nano_usd"),
    cacheWriteCostNanoUsd: integer("cache_write_cost_nano_usd"),
    totalCostNanoUsd: integer("total_cost_nano_usd"),
    finishReason: text("finish_reason"),
  },
  (table) => [
    index("generation_usage_userId_occurredAt_idx").on(
      table.userId,
      table.occurredAt,
    ),
    index("generation_usage_userId_providerId_model_occurredAt_idx").on(
      table.userId,
      table.providerId,
      table.model,
      table.occurredAt,
    ),
    index("generation_usage_context_occurredAt_idx").on(
      table.context,
      table.occurredAt,
    ),
    index("generation_usage_chatId_idx").on(table.chatId),
    index("generation_usage_messageId_idx").on(table.messageId),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  chats: many(chats),
  projects: many(projects),
  agentHosts: many(agentHosts),
  generationUsage: many(generationUsage),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  user: one(user, {
    fields: [chats.userId],
    references: [user.id],
  }),
  project: one(projects, {
    fields: [chats.projectId],
    references: [projects.id],
  }),
  messages: many(messages),
  generationUsage: many(generationUsage),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(user, {
    fields: [projects.userId],
    references: [user.id],
  }),
  chats: many(chats),
}));

export const agentHostsRelations = relations(agentHosts, ({ one, many }) => ({
  user: one(user, {
    fields: [agentHosts.userId],
    references: [user.id],
  }),
  connections: many(agentConnections),
}));

export const agentConnectionsRelations = relations(
  agentConnections,
  ({ one, many }) => ({
    host: one(agentHosts, {
      fields: [agentConnections.hostId],
      references: [agentHosts.id],
    }),
    workspaces: many(agentWorkspaces),
  }),
);

export const agentWorkspacesRelations = relations(
  agentWorkspaces,
  ({ one, many }) => ({
    connection: one(agentConnections, {
      fields: [agentWorkspaces.connectionId],
      references: [agentConnections.id],
    }),
    sessions: many(agentSessions),
  }),
);

export const agentSessionsRelations = relations(agentSessions, ({ one }) => ({
  workspace: one(agentWorkspaces, {
    fields: [agentSessions.workspaceId],
    references: [agentWorkspaces.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  chat: one(chats, {
    fields: [messages.chatId],
    references: [chats.id],
  }),
  generationUsage: many(generationUsage),
}));

export const generationUsageRelations = relations(
  generationUsage,
  ({ one }) => ({
    user: one(user, {
      fields: [generationUsage.userId],
      references: [user.id],
    }),
    chat: one(chats, {
      fields: [generationUsage.chatId],
      references: [chats.id],
    }),
    message: one(messages, {
      fields: [generationUsage.messageId],
      references: [messages.id],
    }),
  }),
);

export type GenerationUsageRow = typeof generationUsage.$inferSelect;
export type NewGenerationUsageRow = typeof generationUsage.$inferInsert;

export const uploads = sqliteTable(
  "uploads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    category: text("category", {
      enum: ["image", "document", "text", "spreadsheet"],
    }).notNull(),
    size: integer("size").notNull(),
    pageCount: integer("page_count"),
    extractedText: text("extracted_text"),
    truncated: integer("truncated", { mode: "boolean" })
      .default(false)
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("uploads_userId_idx").on(table.userId)],
);

export const uploadsRelations = relations(uploads, ({ one }) => ({
  user: one(user, {
    fields: [uploads.userId],
    references: [user.id],
  }),
}));

export const modelConfigs = sqliteTable("model_configs", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  providerId: text("provider_id", { enum: PROVIDER_IDS })
    .default("custom")
    .notNull(),
  apiFormat: text("api_format", { enum: API_FORMAT_IDS })
    .default("openai-chat")
    .notNull(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key"),
  model: text("model").notNull(),
  pricing: text("pricing", { mode: "json" }).$type<ModelPricing>(),
  contextWindow: integer("context_window"),
  discoveredContextWindow: integer("discovered_context_window"),
  discoveredCapabilities: text("discovered_capabilities", {
    mode: "json",
  }).$type<ModelCapabilities>(),
  systemPrompt: text("system_prompt"),
  providerOptions: text("provider_options", { mode: "json" }).$type<
    Record<string, unknown>
  >(),
  toolCallingEnabled: integer("tool_calling_enabled", { mode: "boolean" })
    .default(true)
    .notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
});
