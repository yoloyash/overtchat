import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./sender", () => ({ sendPushNotification: mocks.send }));
import { notifyChatComplete, notifyScheduledRunFailed } from "./chat";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue(undefined);
});

describe("chat notifications", () => {
  const parts = [
    { type: "reasoning", text: "Thinking." },
    { type: "text", text: "Three stories today." },
  ];

  it("announces a reply with its visible text only", async () => {
    await notifyChatComplete("user", "chat", "stream", parts);
    expect(mocks.send).toHaveBeenCalledWith({
      userId: "user",
      kind: "chat",
      targetId: "chat",
      eventId: "stream",
      title: "Your response is ready",
      body: "Tap to view your response.",
      preview: { body: "Three stories today." },
      channelId: "chat-responses",
    });
  });

  it("names the task when the reply is a scheduled run", async () => {
    await notifyChatComplete("user", "chat", "stream", parts, "Morning news");
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "chat",
        eventId: "stream",
        title: "A scheduled task finished",
        body: "Tap to view the result.",
        preview: { title: "Morning news", body: "Three stories today." },
      }),
    );
  });

  it("says why a scheduled run failed, once per run, when there is a chat to open", async () => {
    const run = {
      userId: "user",
      runId: "run",
      chatId: "chat",
      taskName: "Morning news",
      error: `The provider\n  refused. ${"x".repeat(400)}`,
    };
    await notifyScheduledRunFailed(run);
    const sent = mocks.send.mock.calls[0][0];
    expect(sent).toMatchObject({
      userId: "user",
      kind: "chat",
      targetId: "chat",
      eventId: "scheduled-run-failed:run",
      title: "A scheduled task failed",
      preview: { title: "Failed: Morning news" },
    });
    expect(sent.preview.body).toMatch(/^The provider refused\. x+$/);
    expect(sent.preview.body).toHaveLength(240);
    // Lock screens show the title and body: neither carries the task or error.
    expect(`${sent.title} ${sent.body}`).not.toMatch(/Morning|provider/);

    mocks.send.mockClear();
    await notifyScheduledRunFailed({ ...run, chatId: null });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
