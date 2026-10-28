import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { agentSessionNeedsGeneratedTitle } from "@/lib/agents/sessionTitle";
import { db } from "@/lib/db/client";
import {
  applyGeneratedAgentSessionTitle,
  listAgentSessionsAwaitingTitles,
} from "@/lib/db/agentConnections";
import { getTaskModelConfig } from "@/lib/db/modelConfigs";
import { getModelPreferences } from "@/lib/db/modelPreferences";
import { modelConfigs } from "@/lib/db/schema";
import {
  buildTitlePromptFromText,
  generateTitle,
  type TitleModelConfig,
} from "@/lib/title";

/** How long a session waits after its title could not be generated. */
const RETRY_AFTER_MS = 30 * 60_000;

const runs = new Map<string, Promise<void>>();
const retryAt = new Map<string, number>();

/** The task model, or the owner's default chat model, or the first chat model. */
function titleModelConfig(userId: string): TitleModelConfig | null {
  const taskModel = getTaskModelConfig();
  if (taskModel) return taskModel;
  const chatModel = (id?: string) =>
    db
      .select()
      .from(modelConfigs)
      .where(
        and(
          eq(modelConfigs.enabled, true),
          eq(modelConfigs.modelType, "chat"),
          ...(id ? [eq(modelConfigs.id, id)] : []),
        ),
      )
      .orderBy(asc(modelConfigs.sortOrder), asc(modelConfigs.label))
      .limit(1)
      .get() ?? null;
  const { defaultModelId } = getModelPreferences(userId);
  return (defaultModelId ? chatModel(defaultModelId) : null) ?? chatModel();
}

function sessionsAwaitingTitles(userId: string) {
  const now = Date.now();
  return listAgentSessionsAwaitingTitles(userId).filter(
    (session) =>
      agentSessionNeedsGeneratedTitle(session) &&
      (retryAt.get(session.id) ?? 0) <= now,
  );
}

async function titleSessions(userId: string): Promise<void> {
  for (;;) {
    const modelConfig = titleModelConfig(userId);
    if (!modelConfig) return;
    const [session] = sessionsAwaitingTitles(userId);
    if (!session) return;
    let title: string | null = null;
    try {
      const prompt = buildTitlePromptFromText(session.firstMessage ?? "");
      title = prompt
        ? await generateTitle({ prompt, modelConfig, userId })
        : null;
    } catch (error) {
      console.error("[agent-session-title]", error);
    }
    if (
      !title ||
      !applyGeneratedAgentSessionTitle(session.id, session.name, title)
    ) {
      retryAt.set(session.id, Date.now() + RETRY_AFTER_MS);
    }
  }
}

/**
 * Titles an owner's agent sessions in the background, newest first, one at a
 * time. Sessions keep their first-line title until theirs is ready.
 */
export function scheduleAgentSessionTitles(userId: string): void {
  if (runs.has(userId)) return;
  // Leave the request that noticed the sessions before reading them.
  const run = new Promise((resolve) => setTimeout(resolve, 0))
    .then(() => titleSessions(userId))
    .catch((error) => console.error("[agent-session-title]", error))
    .finally(() => runs.delete(userId));
  runs.set(userId, run);
}
