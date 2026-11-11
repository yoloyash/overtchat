import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationUsesGmail,
  describeGmailEmail,
  describeGmailToolPart,
  gmailActivityLabel,
  groupMessageParts,
  replacedGmailEmailIds,
  type GmailToolPart,
} from "@overtchat/shared";
import { z } from "zod";
import { INTEGRATIONS } from "@/lib/integrations/schema";
import { createIntegrationTestDatabase } from "@/lib/integrations/test-database";
import { sharedMessages } from "@/lib/sharing";

vi.mock("server-only", () => ({}));

const database = createIntegrationTestDatabase("gmail-tools");
let repository: typeof import("@/lib/db/integrations");
let tools: typeof import("./gmail-tools");

beforeAll(async () => {
  repository = await import("@/lib/db/integrations");
  tools = await import("./gmail-tools");
});
beforeEach(() => database.reset());
afterAll(() => database.close());

function connect() {
  repository.saveIntegrationAccount({
    userId: "ada",
    provider: "google",
    accountEmail: "ada@example.test",
    refreshToken: "refresh-1",
    accessToken: "access-1",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    scopes: [...INTEGRATIONS.gmail.scopes],
  });
}

describe("availability", () => {
  it("offers the tools only to a user with a live connection", () => {
    expect(tools.gmailAccess("ada")).toEqual({ status: "unavailable" });

    repository.saveIntegrationOauthClient("google", {
      clientId: "client-1",
      clientSecret: "secret-1",
    });
    expect(tools.gmailAccess("ada")).toEqual({ status: "unavailable" });

    connect();
    expect(tools.gmailAccess("ada")).toEqual({ status: "available", alwaysOn: false });
    expect(tools.gmailAccess("grace")).toEqual({ status: "unavailable" });
    repository.setIntegrationAlwaysOn("ada", "gmail", true);
    expect(tools.gmailAccess("ada")).toEqual({ status: "available", alwaysOn: true });

    repository.markIntegrationNeedsReconnect({
      userId: "ada",
      provider: "google",
      refreshToken: "refresh-1",
    });
    expect(tools.gmailAccess("ada")).toEqual({
      status: "needs_reconnect",
      alwaysOn: true,
    });
    expect(tools.gmailReconnectPrompt()).toContain("Settings → Tools → Connectors");
  });

  it("treats a chat as using Gmail once a model has, or once the user asked", () => {
    const user = (text: string) => ({ role: "user", parts: [{ type: "text", text }] });
    const assistant = (type: string) => ({
      role: "assistant",
      parts: [{ type: "text", text: "Done." }, { type }],
    });

    expect(conversationUsesGmail([])).toBe(false);
    expect(
      conversationUsesGmail([user("Any mail from Grace?"), assistant("tool-fetch_url")]),
    ).toBe(false);
    expect(
      conversationUsesGmail([user("Any mail?"), assistant("tool-gmail_search"), user("Thanks")]),
    ).toBe(true);
    // A client without the command menu sends the command as text.
    expect(conversationUsesGmail([user("/gmail any mail from Grace?")])).toBe(true);
    expect(conversationUsesGmail([user("  /GMAIL")])).toBe(true);
    expect(conversationUsesGmail([user("what does /gmail do?")])).toBe(false);
    expect(conversationUsesGmail([user("/gmailer")])).toBe(false);
    // The composer records its choice on the message; a model viewing the
    // skill counts too, a failed view does not.
    expect(
      conversationUsesGmail([{ ...user("Any mail?"), metadata: { skills: ["gmail"] } }]),
    ).toBe(true);
    expect(
      conversationUsesGmail([{ ...user("Any mail?"), metadata: { skills: ["calendar"] } }]),
    ).toBe(false);
    const viewed = (id: string, output: unknown) => ({
      role: "assistant",
      parts: [{ type: "tool-view_skill", state: "output-available", input: { id }, output }],
    });
    expect(conversationUsesGmail([user("Any mail?"), viewed("gmail", "<skill id=\"gmail\" name=\"Gmail\">…</skill>")])).toBe(true);
    expect(conversationUsesGmail([user("Any mail?"), viewed("gmail", "Error: not now")])).toBe(false);
    expect(conversationUsesGmail([user("Any mail?"), viewed("calendar", "<skill id=\"calendar\" name=\"Google Calendar\">…</skill>")])).toBe(false);
    // Only the user turns it on: a model writing the command does not.
    expect(
      conversationUsesGmail([{ role: "assistant", parts: [{ type: "text", text: "/gmail" }] }]),
    ).toBe(false);
  });
});

describe("tool inputs", () => {
  const schema = (
    name:
      | "gmail_read_thread"
      | "gmail_read_attachment"
      | "gmail_modify_labels"
      | "gmail_compose"
      | "gmail_create_draft",
  ) =>
    tools.createGmailTools("ada", { compose: true })[name]!.inputSchema as {
      safeParse: (value: unknown) => { success: boolean };
    };

  it("accepts only Gmail's own IDs, which become API path segments", () => {
    const thread = schema("gmail_read_thread");
    expect(thread.safeParse({ threadId: "19a2b3c4d5e6f708" }).success).toBe(true);
    expect(thread.safeParse({ threadId: "../drafts" }).success).toBe(false);
    expect(thread.safeParse({ threadId: "t1?format=raw" }).success).toBe(false);
  });

  it("names an attachment by its position, and bounds what one call can sort", () => {
    const attachment = schema("gmail_read_attachment");
    expect(attachment.safeParse({ messageId: "m1", attachmentId: "1" }).success).toBe(true);
    expect(attachment.safeParse({ messageId: "m1", attachmentId: "0.2", offset: 60_000 }).success).toBe(true);
    expect(attachment.safeParse({ messageId: "m1", attachmentId: "../x" }).success).toBe(false);
    expect(attachment.safeParse({ messageId: "m1", attachmentId: "1", offset: -1 }).success).toBe(false);

    const sort = schema("gmail_modify_labels");
    expect(sort.safeParse({ threadIds: ["t1"], remove: ["INBOX"] }).success).toBe(true);
    expect(sort.safeParse({ threadIds: [], remove: ["INBOX"] }).success).toBe(false);
    expect(sort.safeParse({ threadIds: ["t1/modify"], remove: ["INBOX"] }).success).toBe(false);
    expect(
      sort.safeParse({
        threadIds: Array.from({ length: 51 }, (_, index) => `t${index}`),
        remove: ["INBOX"],
      }).success,
    ).toBe(false);
  });

  it("offers no way to send, and one way to write an email", () => {
    const common = [
      "gmail_search",
      "gmail_read_thread",
      "gmail_read_attachment",
      "gmail_list_labels",
      "gmail_modify_labels",
    ];
    // A client that shows a written email is told about gmail_compose. The
    // draft tool still runs, for a chat whose loaded instructions name it.
    expect(Object.keys(tools.createGmailTools("ada", { compose: true }))).toEqual([
      ...common,
      "gmail_compose",
      "gmail_create_draft",
    ]);
    expect(tools.gmailOfferedToolNames({ compose: true })).toEqual([
      ...common,
      "gmail_compose",
    ]);
    expect(tools.gmailToolPrompt({ compose: true })).toContain("gmail_compose");
    expect(tools.gmailToolPrompt({ compose: true })).not.toContain("gmail_create_draft");

    // Any other client keeps drafts saved in Gmail, and cannot compose.
    expect(Object.keys(tools.createGmailTools("ada", { compose: false }))).toEqual([
      ...common,
      "gmail_create_draft",
    ]);
    expect(tools.gmailOfferedToolNames({ compose: false })).toEqual([
      ...common,
      "gmail_create_draft",
    ]);
    expect(tools.gmailToolPrompt({ compose: false })).toContain("gmail_create_draft");
    expect(tools.gmailToolPrompt({ compose: false })).not.toContain("gmail_compose");
  });

  it.each(["gmail_compose", "gmail_create_draft"] as const)(
    "%s accepts only addresses as recipients and one-line subjects",
    (name) => {
      const email = schema(name);
      const body = "Hello";
      expect(email.safeParse({ to: ["grace@example.test"], subject: "Hi", body }).success).toBe(true);
      // The check runs here; the schema a model reads stays short.
      expect(JSON.stringify(z.toJSONSchema(email as unknown as z.ZodType))).not.toContain("@");
      expect(email.safeParse({ body, replyToMessageId: "m1" }).success).toBe(true);
      expect(email.safeParse({ to: ["Grace <grace@example.test>"], body }).success).toBe(false);
      expect(email.safeParse({ to: ["grace@example.test\nBcc: x@y.z"], body }).success).toBe(false);
      expect(email.safeParse({ to: ["grace@example.test"], subject: "Hi\nBcc: x@y.z", body }).success).toBe(false);
    },
  );

  it("names the earlier version only by an ID the tool gave", () => {
    const email = schema("gmail_compose");
    const base = { to: ["grace@example.test"], subject: "Hi", body: "Hello" };
    expect(
      email.safeParse({ ...base, replaces: "0b9c1a5e-6d1f-4f0a-9d53-1f6a3f1c2b7e" }).success,
    ).toBe(true);
    expect(email.safeParse({ ...base, replaces: "../drafts" }).success).toBe(false);
  });
});

describe("display", () => {
  const part = (overrides: Partial<GmailToolPart>): GmailToolPart => ({
    type: "tool-gmail_search",
    toolCallId: "call-1",
    state: "output-available",
    ...overrides,
  });

  it("shows a search by its query, count, senders and subjects", () => {
    const search = part({
      input: { query: "from:grace is:unread" },
      output: {
        account: "ada@example.test",
        hasMore: true,
        messages: [
          {
            threadId: "19a2b3c4d5e6f708",
            from: '"Grace Hopper" <grace@example.test>',
            subject: "Numbers",
            date: "2026-11-04T10:00:00.000Z",
            snippet: "private words",
            unread: true,
          },
          { from: "alan@example.test", subject: "" },
        ],
      },
    });

    const display = describeGmailToolPart(search);
    expect(display).toMatchObject({
      action: "search",
      status: "done",
      title: "Searched Gmail",
      detail: "from:grace is:unread",
      note: "2+ results",
      rows: [
        {
          sender: "Grace Hopper",
          subject: "Numbers",
          unread: true,
          href: "https://mail.google.com/mail/?authuser=ada%40example.test#all/19a2b3c4d5e6f708",
        },
        { sender: "alan@example.test", subject: "(no subject)" },
      ],
    });
    // Without a thread to point at, a row is not a link.
    expect(display.rows[1].href).toBeUndefined();
    expect(JSON.stringify(display)).not.toContain("private words");
    expect(gmailActivityLabel(search, true)).toBe(
      'Searching Gmail for "from:grace is:unread"',
    );
    expect(gmailActivityLabel(search, false)).toBe("Searched Gmail");
  });

  it("shows a thread by its subject and senders, never its text", () => {
    const display = describeGmailToolPart(
      part({
        type: "tool-gmail_read_thread",
        output: {
          account: "ada@example.test",
          threadId: "thread-1",
          subject: "Plans",
          messages: [
            {
              from: "Grace <grace@example.test>",
              body: "private words",
              attachments: [{ filename: "plan.pdf" }, { filename: "map.png" }],
            },
            { from: "'Alan Turing' via Staff <staff@example.test>" },
          ],
        },
      }),
    );
    const href =
      "https://mail.google.com/mail/?authuser=ada%40example.test#all/thread-1";
    expect(display).toMatchObject({
      title: "Read email",
      detail: "Plans",
      note: "2 messages",
      rows: [
        { sender: "Grace", attachments: ["plan.pdf", "map.png"], href },
        { sender: "Alan Turing via Staff", href },
      ],
    });
    expect(JSON.stringify(display)).not.toContain("private words");
  });

  it("shows an attachment by its name and length, never its text", () => {
    const attachment = part({
      type: "tool-gmail_read_attachment",
      input: { messageId: "m1", attachmentId: "1" },
      output: {
        filename: "invoice-42.pdf",
        text: "private words",
        offset: 0,
        pageCount: 3,
      },
    });
    const display = describeGmailToolPart(attachment);
    expect(display).toMatchObject({
      action: "attachment",
      title: "Read attachment",
      detail: "invoice-42.pdf",
      note: "3 pages",
    });
    expect(JSON.stringify(display)).not.toContain("private words");
    expect(gmailActivityLabel(attachment, true)).toBe("Reading attachment…");
    expect(
      describeGmailToolPart(
        part({
          type: "tool-gmail_read_attachment",
          output: { filename: "notes.txt", offset: 60_000, pageCount: null },
        }),
      ).note,
    ).toBe("Continued");
  });

  it("says what sorting did in the words of Gmail's own buttons", () => {
    const sort = (added: string[], removed: string[], threads = 3) =>
      describeGmailToolPart(
        part({
          type: "tool-gmail_modify_labels",
          output: { account: "ada@example.test", threads, added, removed },
        }),
      );

    expect(sort([], ["INBOX"])).toMatchObject({
      action: "sort",
      title: "3 conversations archived",
    });
    expect(sort([], ["UNREAD"], 1).title).toBe("1 conversation marked read");
    expect(sort(["Receipts"], []).title).toBe("3 conversations labeled Receipts");
    expect(sort([], ["Receipts"]).title).toBe("3 conversations unlabeled Receipts");
    expect(sort(["TRASH"], []).title).toBe("3 conversations moved to trash");
    expect(sort(["SPAM"], [], 1).title).toBe("1 conversation marked as spam");
    expect(sort(["STARRED", "Receipts"], ["INBOX", "UNREAD"])).toMatchObject({
      title: "3 conversations updated",
      note: "Archived, marked read, starred, labeled Receipts",
    });

    const running = part({ type: "tool-gmail_modify_labels", state: "input-available" });
    expect(describeGmailToolPart(running).title).toBe("Sorting mail");
    expect(gmailActivityLabel(running, true)).toBe("Sorting mail…");

    expect(
      describeGmailToolPart(
        part({
          type: "tool-gmail_list_labels",
          output: { labels: [{ id: "INBOX" }, { id: "Label_1" }] },
        }),
      ),
    ).toMatchObject({ action: "labels", title: "Listed Gmail labels", note: "2 labels" });
  });

  it("names a draft by its subject while it is being written", () => {
    expect(
      describeGmailToolPart(
        part({
          type: "tool-gmail_create_draft",
          state: "input-available",
          input: { subject: "Hi" },
          output: undefined,
        }),
      ),
    ).toMatchObject({ status: "running", title: "Writing draft", detail: "Hi" });
  });

  it("reports a running, failed, or interrupted step", () => {
    const running = part({ state: "input-available", input: {} });
    expect(describeGmailToolPart(running)).toMatchObject({
      status: "running",
      title: "Searching Gmail",
    });
    expect(gmailActivityLabel(running, false)).toBe(
      "Gmail request did not complete",
    );

    const failed = part({ state: "output-error", errorText: "Gmail needs to be reconnected." });
    expect(describeGmailToolPart(failed)).toMatchObject({
      status: "error",
      error: "Gmail needs to be reconnected.",
    });
    expect(gmailActivityLabel(failed, false)).toBe("Gmail request failed");
  });

  it("survives a saved step whose shape it does not recognize", () => {
    expect(
      describeGmailToolPart(part({ input: "x", output: { messages: "nope" } })),
    ).toMatchObject({ status: "done", rows: [], note: "No results" });

    // A step saved before results named their mailbox opens nothing.
    const [row] = describeGmailToolPart(
      part({ output: { messages: [{ threadId: "t1", from: "a@example.test" }] } }),
    ).rows;
    expect(row).toMatchObject({ sender: "a@example.test" });
    expect(row.href).toBeUndefined();

    // Nor does a thread ID that could not be Gmail's.
    expect(
      describeGmailToolPart(
        part({
          output: {
            account: "ada@example.test",
            messages: [{ threadId: "t1/../x", from: "a@example.test" }],
          },
        }),
      ).rows[0].href,
    ).toBeUndefined();
  });
});

describe("in a conversation", () => {
  const gmailPart = {
    type: "tool-gmail_read_thread",
    toolCallId: "call-1",
    state: "output-available",
    input: { threadId: "t1" },
    output: { subject: "Plans", messages: [{ from: "g@example.test", body: "private words" }] },
  };

  it("joins the activity timeline", () => {
    const segments = groupMessageParts([
      { type: "reasoning", text: "Looking" },
      gmailPart,
      { type: "text", text: "Here is the plan." },
    ] as never);
    expect(segments.map((segment) => segment.kind)).toEqual(["activity", "text"]);
    expect(segments[0]).toMatchObject({ parts: [{ type: "reasoning" }, gmailPart] });
  });

  const savedDraft = {
    type: "tool-gmail_create_draft",
    toolCallId: "call-2",
    state: "output-available",
    input: {
      cc: ["alan@example.test"],
      body: "Thanks Grace,\n\nPaying it today.",
      replyToMessageId: "m1",
    },
    output: {
      draftId: "r-42",
      threadId: "t1",
      account: "ada@example.test",
      to: "grace@example.test",
      subject: "Re: Plans",
    },
  } as const;

  const composed = {
    type: "tool-gmail_compose",
    toolCallId: "call-3",
    state: "output-available",
    input: savedDraft.input,
    output: {
      emailId: "e-1",
      threadId: "t1",
      account: "ada@example.test",
      to: "grace@example.test",
      subject: "Re: Plans",
      status: "not_sent",
    },
  } as const;

  it.each([savedDraft, composed])(
    "shows a written email as its own card, outside the timeline ($type)",
    (email) => {
      const segments = groupMessageParts([
        gmailPart,
        email,
        { type: "text", text: "Done." },
      ] as never);
      expect(segments.map((segment) => segment.kind)).toEqual([
        "activity",
        "gmail-email",
        "text",
      ]);

      // Still being written, or failed, it is a step like any other.
      for (const state of ["input-streaming", "input-available", "output-error"]) {
        expect(
          groupMessageParts([{ ...email, state, output: undefined }] as never).map(
            (segment) => segment.kind,
          ),
        ).toEqual(["activity"]);
      }
    },
  );

  it("names the step while an email is being written", () => {
    const writing = { ...composed, state: "input-available", output: undefined };
    expect(gmailActivityLabel(writing as never, true)).toBe("Writing email…");
    expect(describeGmailToolPart(writing as never)).toMatchObject({
      action: "compose",
      title: "Writing email",
    });
  });

  it("describes a draft before and after the user sends it", () => {
    expect(describeGmailEmail(savedDraft as never)).toEqual({
      id: "r-42",
      status: "draft",
      source: "draft",
      subject: "Re: Plans",
      recipients: "To grace@example.test · Cc alan@example.test",
      body: "Thanks Grace,\n\nPaying it today.",
      content: undefined,
      href: "https://mail.google.com/mail/?authuser=ada%40example.test#drafts",
      sentAt: undefined,
    });
    expect(
      describeGmailEmail({
        ...savedDraft,
        output: {
          ...savedDraft.output,
          sent: { at: "2026-11-05T12:00:00.000Z", threadId: "t9" },
        },
      } as never),
    ).toMatchObject({
      status: "sent",
      sentAt: "2026-11-05T12:00:00.000Z",
      href: "https://mail.google.com/mail/?authuser=ada%40example.test#all/t9",
    });
  });

  it("describes a composed email in the chat, in Gmail, and sent", () => {
    // Only the chat holds it: there is nothing in Gmail to open, and the card
    // sends what the model wrote.
    expect(describeGmailEmail(composed as never)).toEqual({
      id: "e-1",
      status: "unsent",
      source: "composed",
      subject: "Re: Plans",
      recipients: "To grace@example.test · Cc alan@example.test",
      body: "Thanks Grace,\n\nPaying it today.",
      content: {
        to: [],
        cc: ["alan@example.test"],
        bcc: [],
        subject: undefined,
        body: "Thanks Grace,\n\nPaying it today.",
        replyToMessageId: "m1",
      },
      href: undefined,
      sentAt: undefined,
    });

    const saved = { ...composed.output, saved: { draftId: "r-7" } };
    expect(describeGmailEmail({ ...composed, output: saved } as never)).toMatchObject({
      id: "e-1",
      status: "draft",
      href: "https://mail.google.com/mail/?authuser=ada%40example.test#drafts",
    });
    expect(
      describeGmailEmail({
        ...composed,
        output: { ...saved, sent: { at: "2026-11-05T12:00:00.000Z", threadId: "t9" } },
      } as never),
    ).toMatchObject({
      status: "sent",
      href: "https://mail.google.com/mail/?authuser=ada%40example.test#all/t9",
    });
  });

  it("marks an email a later version replaced, unless it left the chat", () => {
    const later = {
      ...composed,
      toolCallId: "call-4",
      input: { ...composed.input, replaces: "e-1" },
      output: { ...composed.output, emailId: "e-2" },
    };
    const replaced = replacedGmailEmailIds([
      { parts: [composed] },
      { parts: [{ type: "text" }, later] },
    ] as never);
    expect([...replaced]).toEqual(["e-1"]);
    expect(describeGmailEmail(composed as never, replaced).status).toBe("replaced");
    expect(describeGmailEmail(later as never, replaced).status).toBe("unsent");

    // In Gmail or sent, it is still what that says it is.
    expect(
      describeGmailEmail(
        { ...composed, output: { ...composed.output, saved: { draftId: "r-7" } } } as never,
        replaced,
      ).status,
    ).toBe("draft");

    // A version that failed to be written replaces nothing.
    expect(
      replacedGmailEmailIds([
        { parts: [{ ...later, state: "output-error", output: undefined }] },
      ] as never).size,
    ).toBe(0);
  });

  it("is left out of a shared link", () => {
    const shared = sharedMessages([
      {
        id: "a1",
        role: "assistant",
        parts: [
          gmailPart,
          savedDraft,
          composed,
          { type: "text", text: "Here is the plan." },
        ],
      },
    ] as never);
    expect(JSON.stringify(shared)).not.toContain("private words");
    expect(JSON.stringify(shared)).not.toContain("gmail");
    expect(shared[0].parts).toEqual([{ type: "text", text: "Here is the plan." }]);
  });
});
