import Database from "better-sqlite3";
import type { UIMessage } from "ai";
import type { AgentRuntimeSnapshot } from "@overtchat/agent-bridge";
import type { WebSearchOutput } from "@overtchat/shared";
import { registerSqliteFunctions } from "../lib/db/sqlite-functions";
import conversation from "./conversation.json";

// Keep relative history labels aligned with the server on future capture dates.
export const NOW = Date.now();
export const USER = { name: "Alex Morgan", email: "alex@example.test", password: "readme-demo-account-0000" };

export const searchOutput: WebSearchOutput = {
  provider: "searxng",
  sources: [
    { title: "SearXNG documentation", url: "https://docs.searxng.org/", snippet: "A self-hosted metasearch engine that aggregates results from other search services." },
    { title: "Kokoro-82M model card", url: "https://huggingface.co/hexgrad/Kokoro-82M", snippet: "An open-weight text-to-speech model with 82 million parameters." },
    { title: "Parakeet TDT 0.6B v3", url: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3", snippet: "Automatic speech recognition with support for 25 European languages." },
  ],
};

// Editorial examples, not benchmark results or transcripts from live providers.
const conversations: { id: string; title: string; kind?: "voice"; project?: string; messages: UIMessage[] }[] = [
  {
    id: "local-ai", title: conversation.title, project: "homelab",
    messages: [
      { id: "local-user", role: "user", parts: [{ type: "text", text: conversation.prompt }] },
      { id: "local-assistant", role: "assistant", parts: [{ type: "text", text: conversation.answer }] },
    ],
  },
  {
    id: "search", title: "Local speech and search", project: "homelab",
    messages: [
      { id: "search-user", role: "user", parts: [{ type: "text", text: "Find the projects behind local search, text-to-speech, and dictation. Link me to the originals." }] },
      { id: "search-assistant", role: "assistant", parts: [
        { type: "tool-web_search", toolCallId: "search-demo", state: "output-available", input: { query: "SearXNG Kokoro Parakeet official projects", limit: 3 }, output: searchOutput },
        { type: "text", text: "Three building blocks for your setup:\n\n- **SearXNG** gathers results from multiple search engines through a service you can host yourself. [1](https://docs.searxng.org/)\n- **Kokoro** turns written answers into speech with a compact, open-weight model. [2](https://huggingface.co/hexgrad/Kokoro-82M)\n- **Parakeet** transcribes your microphone input for dictation and voice conversations. [3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)\n\nOvertChat’s setup wizard can install and connect all three." },
      ] },
    ],
  },
  {
    id: "voice", title: "Think it through, out loud", kind: "voice",
    messages: [
      { id: "voice-user", role: "user", parts: [{ type: "text", text: "Let’s talk through my weekend project. I want a small reading nook by the window." }] },
      { id: "voice-assistant", role: "assistant", parts: [{ type: "text", text: "Start with the chair and the light. A comfortable seat angled toward the window gives you daylight without glare. Add a small side table for your book and a warm lamp for the evening.\n\nHow much space do you have to work with?" }] },
      { id: "voice-user-2", role: "user", parts: [{ type: "text", text: "About a metre and a half. Keep it simple, and leave room for a plant." }] },
      { id: "voice-assistant-2", role: "assistant", parts: [{ type: "text", text: "Then I’d choose one compact armchair, a narrow side table, and a floor lamp behind the chair. Put the plant closest to the window. That’s enough to make it feel like its own little space." }] },
    ],
  },
  { id: "notes", title: "Notes for the next release", project: "work", messages: [] },
  { id: "garden", title: "A balcony herb garden", messages: [] },
  { id: "reading", title: "Books for a quiet weekend", messages: [] },
];

export function seedDemo(database: string) {
  // The runner owns this path. Never accept a developer's DATABASE_URL here.
  const db = new Database(database);
  registerSqliteFunctions(db);
  db.pragma("foreign_keys = ON");
  try {
    const user = db.prepare("SELECT id FROM user WHERE email = ?").get(USER.email) as { id: string } | undefined;
    if (!user) throw new Error("Create the isolated demo account before seeding.");
    db.transaction(() => {
      // Auth creates random IDs; the web avatar palette is derived from that ID.
      // Preserve the real credential/session records while fixing the demo identity.
      db.pragma("defer_foreign_keys = ON");
      const demoId = "readme-alex-morgan";
      db.prepare("UPDATE user SET id = ? WHERE id = ?").run(demoId, user.id);
      db.prepare("UPDATE session SET user_id = ? WHERE user_id = ?").run(demoId, user.id);
      db.prepare("UPDATE account SET user_id = ?, account_id = ? WHERE user_id = ?").run(demoId, demoId, user.id);
      user.id = demoId;
      for (const [id, name] of [["homelab", "Home lab"], ["work", "Workbench"]]) {
        db.prepare("INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, user.id, name, NOW, NOW);
      }
      db.prepare(`INSERT INTO model_configs
        (id, label, provider_id, api_format, base_url, model, context_window, created_at, updated_at)
        VALUES ('local-model', 'Qwen3.8 Flash · SGLang', 'sglang', 'openai-chat', 'http://model.example.test/v1', 'qwen3.8-flash-next', 131072, ?, ?)`).run(NOW, NOW);
      conversations.forEach((chat, index) => {
        db.prepare("INSERT INTO chats (id, user_id, title, kind, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(chat.id, user.id, chat.title, chat.kind ?? "text", chat.project ?? null, NOW - index * 60_000, NOW - index * 60_000);
        chat.messages.forEach((message, messageIndex) => {
          db.prepare("INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(message.id, chat.id, message.role, JSON.stringify(message.parts), NOW + messageIndex);
        });
      });
      db.prepare("INSERT INTO host_connectors (id, user_id, name, token_hash) VALUES ('demo-connector', ?, 'Home workstation', 'not-a-real-token')").run(user.id);
      db.prepare("INSERT INTO agent_hosts (id, user_id, connector_id, name, transport) VALUES ('demo-host', ?, 'demo-connector', 'Home workstation', 'local')").run(user.id);
      db.prepare("INSERT INTO agent_connections (id, host_id, provider, executable) VALUES ('demo-connection', 'demo-host', 'codex', 'codex')").run();
      db.prepare("INSERT INTO agent_workspaces (id, connection_id, path, name) VALUES ('demo-workspace', 'demo-connection', '/home/alex/projects/reading-room', 'reading-room')").run();
      db.prepare(`INSERT INTO agent_sessions (id, workspace_id, provider_session_id, provider_session_path, name, first_message, message_count)
        VALUES ('demo-agent', 'demo-workspace', 'demo-native', '/home/alex/projects/reading-room/session.jsonl', 'Make room for saved books', 'Add a reading list to the app.', 2)`).run();
    })();
  } finally { db.close(); }
}

const agentModel: AgentRuntimeSnapshot["models"][number] = {
  id: "codex-demo", label: "Codex", provider: "codex", api: "codex-app-server", baseUrl: "",
  reasoning: true, input: ["text", "image"], contextWindow: 200_000, maxTokens: 16_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export const agentSnapshot: AgentRuntimeSnapshot = {
  sessionId: "demo-agent", provider: "codex", status: "idle", activeTurn: null,
  capabilities: { steer: true, usage: true, editSentMessages: true, forkMessages: true },
  state: { isStreaming: false, isCompacting: false, sessionName: "Make room for saved books", model: agentModel, thinkingLevel: "high" },
  models: [agentModel], commands: [], queuedMessages: [],
  stats: {
    sessionFile: "/home/alex/projects/reading-room/session.jsonl", sessionId: "demo-native",
    userMessages: 1, assistantMessages: 2, toolCalls: 0, toolResults: 0, totalMessages: 3,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
  },
  messages: [
    { id: "agent-user", role: "user", content: "Add a reading list to the app. Let me save a book and mark it as finished.", timestamp: NOW },
    { id: "agent-plan", role: "assistant", timestamp: NOW + 1, content: [{ type: "plan", id: "plan", text: "- [x] Add saved books\n- [x] Build the reading list\n- [x] Check the complete flow", steps: [{ step: "Add saved books", status: "completed" }, { step: "Build the reading list", status: "completed" }, { step: "Check the complete flow", status: "completed" }] }] },
    { id: "agent-answer", role: "assistant", timestamp: NOW + 2, content: [{ type: "text", text: "The reading list is ready.\n\n- Save a book from its detail page.\n- Find saved titles in **Your reading list**.\n- Mark a book as finished, or move it back to your list.\n\nThe list stays with your account when you switch devices.\n\n### What changed\n\n`src/components/ReadingList.tsx` — the list and its empty state.\n\n`src/lib/books.ts` — save, finish, and restore actions.\n\nThe save → finish → restore flow passes." }] },
  ],
};
