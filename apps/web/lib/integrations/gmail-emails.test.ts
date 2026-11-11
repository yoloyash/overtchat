import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { INTEGRATIONS } from "@/lib/integrations/schema";
import { createIntegrationTestDatabase } from "@/lib/integrations/test-database";

vi.mock("server-only", () => ({}));

const database = createIntegrationTestDatabase("gmail-emails");
let repository: typeof import("@/lib/db/integrations");
let records: typeof import("@/lib/db/gmail-emails");
let sentDrafts: typeof import("@/lib/db/gmail-drafts");
let emails: typeof import("./gmail-emails");

interface Recorded {
  path: string;
  method: string;
  body: unknown;
}

/** Stands in for Gmail's send and draft endpoints. */
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

const content = {
  to: ["grace@example.test"],
  cc: [],
  bcc: [],
  subject: "Lunch",
  body: "Thursday at noon?",
};

beforeAll(async () => {
  repository = await import("@/lib/db/integrations");
  records = await import("@/lib/db/gmail-emails");
  sentDrafts = await import("@/lib/db/gmail-drafts");
  emails = await import("./gmail-emails");
});
beforeEach(() => {
  database.reset();
  repository.saveIntegrationOauthClient("google", {
    clientId: "client-1",
    clientSecret: "secret-1",
  });
  repository.saveIntegrationAccount({
    userId: "ada",
    provider: "google",
    accountEmail: "ada@example.test",
    refreshToken: "refresh-1",
    accessToken: "access-1",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    scopes: [...INTEGRATIONS.gmail.scopes],
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => database.close());

describe("sending a composed email", () => {
  it("sends what was written, once, however often it is asked", async () => {
    const requests = gmail(() => ({ body: { id: "m9", threadId: "t9" } }));

    // Two presses at once, then a third after the first finished.
    const [first, second] = await Promise.all([
      emails.sendComposedGmailEmail("ada", "e-1", content),
      emails.sendComposedGmailEmail("ada", "e-1", content),
    ]);
    const third = await emails.sendComposedGmailEmail("ada", "e-1", content);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /messages/send",
    ]);
    expect(first.threadId).toBe("t9");
    expect(Date.now() - new Date(first.at).getTime()).toBeLessThan(5000);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("records nothing when Gmail refuses, so it can be tried again", async () => {
    let refuse = true;
    const requests = gmail(() =>
      refuse
        ? { status: 400, body: { error: { message: "Invalid To header" } } }
        : { body: { id: "m9", threadId: "t9" } },
    );

    await expect(
      emails.sendComposedGmailEmail("ada", "e-1", content),
    ).rejects.toThrow(/Gmail returned an error/);
    expect(records.getGmailEmail("ada", "e-1")).toBeNull();

    refuse = false;
    await expect(
      emails.sendComposedGmailEmail("ada", "e-1", content),
    ).resolves.toMatchObject({ threadId: "t9" });
    expect(requests).toHaveLength(2);
  });

  it("keeps each user's emails apart", async () => {
    gmail(() => ({ body: { id: "m9", threadId: "t9" } }));
    await emails.sendComposedGmailEmail("ada", "e-1", content);

    // Grace has no Gmail connected, and Ada's record is not hers.
    await expect(
      emails.sendComposedGmailEmail("grace", "e-1", content),
    ).rejects.toMatchObject({ status: 409 });
    expect(records.getGmailEmail("grace", "e-1")).toBeNull();
  });
});

describe("saving a composed email in Gmail", () => {
  it("saves one draft, and Send then sends that draft as it stands", async () => {
    const requests = gmail((request) =>
      request.path === "/drafts"
        ? { body: { id: "r-7", message: { threadId: "t7" } } }
        : { body: { id: "m9", threadId: "t7" } },
    );

    const [first, second] = await Promise.all([
      emails.saveComposedGmailEmail("ada", "e-1", content),
      emails.saveComposedGmailEmail("ada", "e-1", content),
    ]);
    expect(first).toEqual({ draftId: "r-7" });
    expect(second).toEqual(first);
    expect(requests.map((request) => request.path)).toEqual(["/drafts"]);

    // The user may have edited it in Gmail, so the draft is what goes out.
    const sent = await emails.sendComposedGmailEmail("ada", "e-1", content);
    expect(requests.at(-1)).toEqual({
      path: "/drafts/send",
      method: "POST",
      body: { id: "r-7" },
    });
    expect(sent.threadId).toBe("t7");
    expect(requests.some((request) => request.path === "/messages/send")).toBe(false);

    await expect(
      emails.saveComposedGmailEmail("ada", "e-1", content),
    ).rejects.toMatchObject({ status: 409, message: "This email has already been sent." });
    expect(requests).toHaveLength(2);
  });

  it("says so when the saved draft is gone from Gmail", async () => {
    gmail((request) =>
      request.path === "/drafts"
        ? { body: { id: "r-7" } }
        : { status: 404, body: { error: { message: "Not Found" } } },
    );
    await emails.saveComposedGmailEmail("ada", "e-1", content);

    await expect(
      emails.sendComposedGmailEmail("ada", "e-1", content),
    ).rejects.toMatchObject({
      status: 404,
      message:
        "This draft is no longer in Gmail. It may already have been sent or deleted there.",
    });
    expect(records.getGmailEmail("ada", "e-1")).toMatchObject({ sentAt: null });
  });
});

describe("what a client is shown", () => {
  const composed = (emailId: string) => ({
    type: "tool-gmail_compose",
    toolCallId: `call-${emailId}`,
    state: "output-available",
    input: content,
    output: { emailId, account: "ada@example.test", status: "not_sent" },
  });
  const conversation = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Write to Grace" }] },
    {
      id: "a1",
      role: "assistant",
      parts: [
        composed("e-1"),
        composed("e-2"),
        composed("e-3"),
        {
          type: "tool-gmail_create_draft",
          toolCallId: "call-draft",
          state: "output-available",
          output: { draftId: "r-42" },
        },
      ],
    },
  ] as unknown as UIMessage[];

  it("marks what was saved and sent, and leaves the stored message alone", () => {
    expect(emails.withGmailEmailState("ada", conversation)).toBe(conversation);

    records.recordSavedGmailEmail({ userId: "ada", emailId: "e-1", draftId: "r-7" });
    records.recordSavedGmailEmail({ userId: "ada", emailId: "e-2", draftId: "r-8" });
    const sentAt = new Date("2026-11-05T12:00:00.000Z");
    records.recordSentGmailEmail({ userId: "ada", emailId: "e-2", threadId: "t9", sentAt });
    sentDrafts.recordSentGmailDraft({
      userId: "ada",
      draftId: "r-42",
      threadId: "t4",
      sentAt,
    });

    const [, assistant] = emails.withGmailEmailState("ada", conversation);
    const outputs = assistant.parts.map(
      (part) => (part as { output: Record<string, unknown> }).output,
    );
    expect(outputs[0]).toMatchObject({ emailId: "e-1", saved: { draftId: "r-7" } });
    expect(outputs[0]).not.toHaveProperty("sent");
    expect(outputs[1]).toMatchObject({
      saved: { draftId: "r-8" },
      sent: { at: "2026-11-05T12:00:00.000Z", threadId: "t9" },
    });
    expect(outputs[2]).toEqual({
      emailId: "e-3",
      account: "ada@example.test",
      status: "not_sent",
    });
    // A draft a model saved keeps its own record.
    expect(outputs[3]).toMatchObject({ draftId: "r-42", sent: { threadId: "t4" } });
    expect(JSON.stringify(conversation)).not.toContain("saved");

    // Another reader of the same messages sees nothing of Ada's.
    expect(emails.withGmailEmailState("grace", conversation)).toBe(conversation);
  });

  it("keeps the first time an email was sent", () => {
    const first = new Date("2026-11-05T12:00:00.000Z");
    records.recordSentGmailEmail({ userId: "ada", emailId: "e-1", threadId: "t1", sentAt: first });
    records.recordSentGmailEmail({
      userId: "ada",
      emailId: "e-1",
      threadId: "t2",
      sentAt: new Date("2026-11-06T12:00:00.000Z"),
    });
    expect(records.getGmailEmail("ada", "e-1")).toMatchObject({
      threadId: "t1",
      sentAt: first,
    });
  });
});
