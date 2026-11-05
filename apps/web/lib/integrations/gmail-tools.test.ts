import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeGmailToolPart,
  gmailActivityLabel,
  groupMessageParts,
  type GmailToolPart,
} from "@overtchat/shared";
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

function connect(refreshTokenExpiresAt: Date | null = null) {
  repository.saveIntegrationConnection({
    userId: "ada",
    integrationId: "gmail",
    accountEmail: "ada@example.test",
    refreshToken: "refresh-1",
    refreshTokenExpiresAt,
    accessToken: "access-1",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
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
    expect(tools.gmailAccess("ada")).toEqual({ status: "available" });
    expect(tools.gmailAccess("grace")).toEqual({ status: "unavailable" });

    repository.markIntegrationNeedsReconnect({
      userId: "ada",
      integrationId: "gmail",
      refreshToken: "refresh-1",
    });
    expect(tools.gmailAccess("ada")).toEqual({
      status: "needs_reconnect",
      timeLimited: false,
    });
  });

  it("tells a weekly sign-in that ran out from one Google withdrew", () => {
    repository.saveIntegrationOauthClient("google", {
      clientId: "client-1",
      clientSecret: "secret-1",
    });
    connect(new Date(Date.now() + 60_000));
    expect(tools.gmailAccess("ada")).toEqual({ status: "available" });

    connect(new Date(Date.now() - 1000));
    const access = tools.gmailAccess("ada");
    expect(access).toEqual({ status: "needs_reconnect", timeLimited: true });

    const routine = tools.gmailReconnectPrompt({ timeLimited: true });
    expect(routine).toContain("Settings → Tools → Connectors");
    expect(routine).toContain("this is routine");
    expect(tools.gmailReconnectPrompt({ timeLimited: false })).not.toContain(
      "this is routine",
    );
  });
});

describe("tool inputs", () => {
  const schema = (
    name:
      | "gmail_read_thread"
      | "gmail_read_attachment"
      | "gmail_modify_labels"
      | "gmail_create_draft",
  ) =>
    tools.createGmailTools("ada")[name].inputSchema as {
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

  it("offers no way to send or delete", () => {
    expect(Object.keys(tools.createGmailTools("ada"))).toEqual([
      "gmail_search",
      "gmail_read_thread",
      "gmail_read_attachment",
      "gmail_list_labels",
      "gmail_modify_labels",
      "gmail_create_draft",
    ]);
  });

  it("accepts only addresses as recipients and one-line subjects", () => {
    const draft = schema("gmail_create_draft");
    const body = "Hello";
    expect(draft.safeParse({ to: ["grace@example.test"], subject: "Hi", body }).success).toBe(true);
    expect(draft.safeParse({ body, replyToMessageId: "m1" }).success).toBe(true);
    expect(draft.safeParse({ to: ["Grace <grace@example.test>"], body }).success).toBe(false);
    expect(draft.safeParse({ to: ["grace@example.test\nBcc: x@y.z"], body }).success).toBe(false);
    expect(draft.safeParse({ to: ["grace@example.test"], subject: "Hi\nBcc: x@y.z", body }).success).toBe(false);
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

  it("links a saved draft to the right account's drafts", () => {
    expect(
      describeGmailToolPart(
        part({
          type: "tool-gmail_create_draft",
          input: { subject: "Hi" },
          output: { account: "ada@example.test", to: "grace@example.test", subject: "Hi" },
        }),
      ),
    ).toMatchObject({
      title: "Saved draft in Gmail",
      detail: "Hi",
      recipient: "grace@example.test",
      href: "https://mail.google.com/mail/?authuser=ada%40example.test#drafts",
    });
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

  it("is left out of a shared link", () => {
    const shared = sharedMessages([
      {
        id: "a1",
        role: "assistant",
        parts: [gmailPart, { type: "text", text: "Here is the plan." }],
      },
    ] as never);
    expect(JSON.stringify(shared)).not.toContain("private words");
    expect(JSON.stringify(shared)).not.toContain("gmail");
    expect(shared[0].parts).toEqual([{ type: "text", text: "Here is the plan." }]);
  });
});
