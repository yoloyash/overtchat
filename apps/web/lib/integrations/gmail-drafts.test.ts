import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { createIntegrationTestDatabase } from "@/lib/integrations/test-database";

vi.mock("server-only", () => ({}));

const database = createIntegrationTestDatabase("gmail-drafts");
let repository: typeof import("@/lib/db/integrations");
let sentDrafts: typeof import("@/lib/db/gmail-drafts");
let drafts: typeof import("./gmail-drafts");

interface Recorded {
  path: string;
  method: string;
  body: unknown;
}

/** Stands in for Gmail's send endpoint. */
function gmail(answer: (request: Recorded) => { status?: number; body: unknown }) {
  const requests: Recorded[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request: Recorded = {
      path: new URL(String(input)).pathname.replace("/gmail/v1/users/me", ""),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const { status = 200, body } = answer(request);
    return new Response(JSON.stringify(body), { status });
  });
  return requests;
}

beforeAll(async () => {
  repository = await import("@/lib/db/integrations");
  sentDrafts = await import("@/lib/db/gmail-drafts");
  drafts = await import("./gmail-drafts");
});
beforeEach(() => {
  database.reset();
  repository.saveIntegrationOauthClient("google", {
    clientId: "client-1",
    clientSecret: "secret-1",
  });
  repository.saveIntegrationConnection({
    userId: "ada",
    integrationId: "gmail",
    accountEmail: "ada@example.test",
    refreshToken: "refresh-1",
    accessToken: "access-1",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => database.close());

describe("sending a draft", () => {
  it("sends it once, however often it is asked", async () => {
    const requests = gmail(() => ({ body: { id: "m9", threadId: "t9" } }));

    const sent = await drafts.sendSavedGmailDraft("ada", "r-42");

    expect(requests).toEqual([
      { path: "/drafts/send", method: "POST", body: { id: "r-42" } },
    ]);
    expect(sent.threadId).toBe("t9");
    expect(Date.now() - new Date(sent.at).getTime()).toBeLessThan(5000);

    await expect(drafts.sendSavedGmailDraft("ada", "r-42")).resolves.toEqual(sent);
    expect(requests).toHaveLength(1);
  });

  it("says so when the draft is gone from Gmail, and records nothing", async () => {
    gmail(() => ({ status: 404, body: { error: { message: "Not Found" } } }));

    await expect(drafts.sendSavedGmailDraft("ada", "r-42")).rejects.toMatchObject({
      status: 404,
      message:
        "This draft is no longer in Gmail. It may already have been sent or deleted there.",
    });
    expect(sentDrafts.getSentGmailDraft("ada", "r-42")).toBeNull();
  });

  it("answers a second press that lost the race with the first one's result", async () => {
    // Gmail has already sent and removed the draft for the other request.
    gmail(() => {
      sentDrafts.recordSentGmailDraft({
        userId: "ada",
        draftId: "r-42",
        threadId: "t9",
        sentAt: new Date("2026-11-05T12:00:00.000Z"),
      });
      return { status: 404, body: {} };
    });

    await expect(drafts.sendSavedGmailDraft("ada", "r-42")).resolves.toEqual({
      at: "2026-11-05T12:00:00.000Z",
      threadId: "t9",
    });
  });

  it("does not send for someone whose mailbox is not connected", async () => {
    const requests = gmail(() => ({ body: {} }));

    await expect(drafts.sendSavedGmailDraft("grace", "r-42")).rejects.toMatchObject({
      status: 409,
    });
    expect(requests).toHaveLength(0);
  });
});

describe("showing what was sent", () => {
  const draftPart = (draftId: string) => ({
    type: "tool-gmail_create_draft",
    toolCallId: `call-${draftId}`,
    state: "output-available",
    input: { body: "Hello" },
    output: { draftId, threadId: null, account: "ada@example.test", to: "g@example.test", subject: "Hi" },
  });
  const conversation = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Write to Grace" }] },
    { id: "a1", role: "assistant", parts: [draftPart("r-1"), draftPart("r-2")] },
  ] as unknown as UIMessage[];

  it("marks the drafts this user sent and leaves the rest as they were", () => {
    expect(drafts.withSentGmailDrafts("ada", conversation)).toBe(conversation);

    sentDrafts.recordSentGmailDraft({
      userId: "ada",
      draftId: "r-2",
      threadId: "t2",
      sentAt: new Date("2026-11-05T12:00:00.000Z"),
    });

    const [, assistant] = drafts.withSentGmailDrafts("ada", conversation);
    expect(assistant.parts[0]).toEqual(draftPart("r-1"));
    expect(assistant.parts[1]).toEqual({
      ...draftPart("r-2"),
      output: {
        ...draftPart("r-2").output,
        sent: { at: "2026-11-05T12:00:00.000Z", threadId: "t2" },
      },
    });
    // Another person's chat with the same draft ID is not theirs to mark.
    expect(drafts.withSentGmailDrafts("grace", conversation)).toBe(conversation);
    // The stored conversation, which a model reads, is untouched.
    expect(JSON.stringify(conversation)).not.toContain("sent");
  });
});
