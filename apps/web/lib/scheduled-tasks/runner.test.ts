import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "./test-database";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => fixture);
const mocks = vi.hoisted(() => ({ runChat: vi.fn(), notifyFailed: vi.fn() }));
vi.mock("@/lib/chat/run", () => ({ runChat: mocks.runChat }));
vi.mock("@/lib/notifications/chat", () => ({
  notifyScheduledRunFailed: mocks.notifyFailed,
}));
const { raw, db, reset } = createTestDatabase();
fixture.db = db;
const store = await import("@/lib/db/scheduledTasks");
const { ChatRequestError } = await import("@/lib/chat/request");
const { runScheduledTask, SCHEDULED_RUN_TIMEOUT_MS } = await import("./runner");

type RunChatArgs = [
  Request,
  { id: string; role?: string | null },
  { chatId: string; clientRequestId: string; [key: string]: unknown },
  {
    signal: AbortSignal;
    unattended: { title: string };
    onUserMessage: (message: unknown) => void;
  },
];

/**
 * Stands in for the chat pipeline: writes the chat and its generation the way
 * a turn does, and answers with a stream that has already ended.
 */
function chatThat(
  status: "complete" | "aborted" | "error" | "running",
  error: string | null = null,
) {
  return async (...[, user, input, options]: RunChatArgs) => {
    raw
      .prepare("INSERT INTO chats (id, user_id, title) VALUES (?, ?, ?)")
      .run(input.chatId, user.id, options.unattended.title);
    options.onUserMessage({});
    raw
      .prepare(
        "INSERT INTO chat_generations (id, chat_id, user_id, client_request_id, request_fingerprint, status, error) VALUES (?, ?, ?, ?, 'f', ?, ?)",
      )
      .run(crypto.randomUUID(), input.chatId, user.id, input.clientRequestId, status, error);
    return new Response("data: done\n\n");
  };
}

const claim = (over: { project?: boolean } = {}) => {
  const task = store.createScheduledTask("a", {
    name: "Morning news",
    prompt: "Summarize today's news.",
    modelConfigId: "one",
    schedule: { frequency: "daily", hour: 9, minute: 0 },
    timeZone: "Asia/Kolkata",
    webSearchEnabled: false,
    ...(over.project ? { projectId: "p" } : {}),
  });
  return store.claimManualRun(task.id, "a");
};
const runOf = (runId: string) => store.getScheduledTaskRun(runId, "a");

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  mocks.notifyFailed.mockResolvedValue(undefined);
});

describe("a scheduled run", () => {
  it("sends the prompt through the chat pipeline as its owner, unattended", async () => {
    mocks.runChat.mockImplementation(chatThat("complete"));
    const claimed = claim({ project: true });
    await runScheduledTask(claimed);

    const [, user, input, options] = mocks.runChat.mock.calls[0] as RunChatArgs;
    expect(user).toEqual({ id: "a", role: null });
    expect(input).toMatchObject({
      modelConfigId: "one",
      clientRequestId: `scheduled-task-run:${claimed.runId}`,
      webSearchEnabled: false,
      timeZone: "Asia/Kolkata",
      projectId: "p",
      action: { type: "submit" },
      temporary: false,
      gmailComposeSupported: true,
    });
    expect(input.messages).toMatchObject([
      { role: "user", parts: [{ type: "text", text: "Summarize today's news." }] },
    ]);
    expect(options.unattended).toEqual({ title: "Morning news" });
    expect(options.signal).toBeInstanceOf(AbortSignal);

    expect(runOf(claimed.runId)).toMatchObject({
      status: "success",
      chatId: input.chatId,
      error: null,
      seen: false,
    });
    expect(mocks.notifyFailed).not.toHaveBeenCalled();
  });

  it("records a reply that failed, and tells the owner", async () => {
    mocks.runChat.mockImplementation(chatThat("error", "The provider refused."));
    const claimed = claim();
    await runScheduledTask(claimed);
    const run = runOf(claimed.runId);
    expect(run).toMatchObject({ status: "error", error: "The provider refused." });
    expect(mocks.notifyFailed).toHaveBeenCalledWith({
      userId: "a",
      runId: claimed.runId,
      chatId: run?.chatId,
      taskName: "Morning news",
      error: "The provider refused.",
    });
  });

  it("records a run the owner stopped as stopped, not failed", async () => {
    mocks.runChat.mockImplementation(chatThat("aborted"));
    const claimed = claim();
    await runScheduledTask(claimed);
    expect(runOf(claimed.runId)).toMatchObject({
      status: "interrupted",
      error: "Stopped by hand.",
    });
    expect(mocks.notifyFailed).not.toHaveBeenCalled();
  });

  it("records a run that hit the time limit as failed", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    mocks.runChat.mockImplementation(chatThat("aborted"));
    const claimed = claim();
    await runScheduledTask(claimed);
    expect(timeout).toHaveBeenCalledWith(SCHEDULED_RUN_TIMEOUT_MS);
    expect(runOf(claimed.runId)).toMatchObject({
      status: "error",
      error: "Stopped after 30 minutes without finishing.",
    });
    timeout.mockRestore();
  });

  it("records a request the pipeline refused, with no chat", async () => {
    mocks.runChat.mockRejectedValueOnce(new ChatRequestError("Project not found.", 404));
    const refused = claim();
    await runScheduledTask(refused);
    expect(runOf(refused.runId)).toMatchObject({
      status: "error",
      error: "Project not found.",
      chatId: null,
      seen: true,
    });

    mocks.runChat.mockResolvedValueOnce(new Response("Too many requests", { status: 429 }));
    const limited = claim();
    await runScheduledTask(limited);
    expect(runOf(limited.runId)).toMatchObject({
      status: "error",
      error: "Too many requests",
    });

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runChat.mockRejectedValueOnce(new Error("Disk full."));
    const broken = claim();
    await expect(runScheduledTask(broken)).resolves.toBeUndefined();
    expect(runOf(broken.runId)).toMatchObject({ status: "error", error: "Disk full." });
    error.mockRestore();
  });

  it("switches the task off when its model is gone, without calling a model", async () => {
    const claimed = claim();
    raw.exec("UPDATE model_configs SET enabled = 0 WHERE id = 'one'");
    await runScheduledTask(claimed);
    expect(mocks.runChat).not.toHaveBeenCalled();
    expect(store.getScheduledTask(claimed.task.id, "a")).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason:
        "The model this task ran on is no longer available. Choose another to turn it back on.",
      lastRun: { status: "error" },
    });
  });

  it("switches the task off when the account is suspended", async () => {
    const claimed = claim();
    raw.exec("UPDATE user SET banned = 1 WHERE id = 'a'");
    await runScheduledTask(claimed);
    expect(mocks.runChat).not.toHaveBeenCalled();
    expect(store.getScheduledTask(claimed.task.id, "a")).toMatchObject({
      enabled: false,
      pausedReason: "The account is suspended.",
    });
  });
});
