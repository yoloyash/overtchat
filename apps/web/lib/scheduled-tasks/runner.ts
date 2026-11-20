import "server-only";
import { eq } from "drizzle-orm";
import { ChatRequestError } from "@/lib/chat/request";
import { runChat } from "@/lib/chat/run";
import { db } from "@/lib/db/client";
import { getChatGenerationByRequestId } from "@/lib/db/chatTurns";
import { isSelectableChatModel } from "@/lib/db/modelPreferences";
import {
  finishRun,
  setRunChat,
  type ClaimedRun,
  type RunOutcome,
} from "@/lib/db/scheduledTasks";
import { user } from "@/lib/db/schema";
import { notifyScheduledRunFailed } from "@/lib/notifications/chat";

/** How long one run may take before it is stopped. */
export const SCHEDULED_RUN_TIMEOUT_MS = 30 * 60_000;

const MODEL_GONE =
  "The model this task ran on is no longer available. Choose another to turn it back on.";
const ACCOUNT_SUSPENDED = "The account is suspended.";

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The run failed.";
}

/** The generation's final state, read once it has been written. */
async function settledGeneration(userId: string, clientRequestId: string) {
  // The reply is saved as its stream closes; give that write a moment.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const generation = await getChatGenerationByRequestId(userId, clientRequestId);
    if (!generation || generation.status !== "running") return generation;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return getChatGenerationByRequestId(userId, clientRequestId);
}

/**
 * Carries one claimed run through the chat pipeline as its owner: a new chat
 * titled with the task's name, the prompt as its first message, and the same
 * generation, tools and persistence as a message typed into the composer.
 */
async function execute(
  claim: ClaimedRun,
  onChat: (chatId: string) => void,
): Promise<RunOutcome> {
  const { task, runId } = claim;
  const owner = db
    .select({ id: user.id, role: user.role, banned: user.banned })
    .from(user)
    .where(eq(user.id, task.userId))
    .get();
  if (!owner) return { status: "skipped", error: "The account no longer exists." };
  if (owner.banned) {
    return { status: "error", error: ACCOUNT_SUSPENDED, pause: ACCOUNT_SUSPENDED };
  }
  if (!task.modelConfigId || !isSelectableChatModel(db, task.modelConfigId)) {
    return { status: "error", error: MODEL_GONE, pause: MODEL_GONE };
  }

  const chatId = crypto.randomUUID();
  const clientRequestId = `scheduled-task-run:${runId}`;
  const timeout = AbortSignal.timeout(SCHEDULED_RUN_TIMEOUT_MS);
  let response: Response;
  try {
    response = await runChat(
      new Request("http://scheduled-task.invalid/"),
      { id: owner.id, role: owner.role },
      {
        messages: [
          {
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text: task.prompt }],
          },
        ],
        modelConfigId: task.modelConfigId,
        chatId,
        clientRequestId,
        webSearchEnabled: task.webSearchEnabled,
        forceSearch: false,
        // The chat is read later in a current client, which renders these.
        documentsSupported: true,
        codeExecutionSupported: true,
        gmailComposeSupported: true,
        timeZone: task.timeZone,
        projectId: task.projectId,
        action: { type: "submit" },
        reasoningLevel: "default",
        temporary: false,
        responseStyle: "text",
      },
      {
        signal: timeout,
        unattended: { title: task.name },
        // The chat exists from here on, whatever becomes of the reply.
        onUserMessage: () => onChat(chatId),
      },
    );
  } catch (error) {
    if (error instanceof ChatRequestError) {
      return { status: "error", error: error.message };
    }
    throw error;
  }

  if (!response.ok) {
    const text = (await response.text().catch(() => "")).trim();
    return {
      status: "error",
      error: text || `The run could not start (HTTP ${response.status}).`,
    };
  }
  // Read the reply to its end, as a browser would; saving happens as it closes.
  try {
    await response.body?.pipeTo(new WritableStream());
  } catch {
    // A broken stream is reported by the generation's own record below.
  }

  const generation = await settledGeneration(owner.id, clientRequestId);
  if (!generation) return { status: "error", error: "The run left no record." };
  switch (generation.status) {
    case "complete":
      return { status: "success" };
    case "aborted":
      return timeout.aborted
        ? {
            status: "error",
            error: `Stopped after ${SCHEDULED_RUN_TIMEOUT_MS / 60_000} minutes without finishing.`,
          }
        : { status: "interrupted", error: "Stopped by hand." };
    case "error":
      return {
        status: "error",
        error: generation.error ?? "The model's reply failed.",
      };
    default:
      return { status: "error", error: "The run did not finish." };
  }
}

/** Runs a claimed task to its end and records how it went. Never throws. */
export async function runScheduledTask(claim: ClaimedRun): Promise<void> {
  let chatId: string | null = null;
  let outcome: RunOutcome;
  try {
    outcome = await execute(claim, (id) => {
      chatId = id;
      setRunChat(claim.runId, id);
    });
  } catch (error) {
    console.error("[scheduled-tasks] run failed", error);
    outcome = { status: "error", error: errorText(error) };
  }
  try {
    finishRun(claim.runId, outcome);
  } catch (error) {
    console.error("[scheduled-tasks] could not record a run", error);
    return;
  }
  if (outcome.status === "error") {
    void notifyScheduledRunFailed({
      userId: claim.task.userId,
      runId: claim.runId,
      chatId,
      taskName: claim.task.name,
      error: outcome.error ?? "The run failed.",
    }).catch(() =>
      console.error("[push] Could not send scheduled task notification."),
    );
  }
}
