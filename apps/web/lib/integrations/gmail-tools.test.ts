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
  const schema = (name: "gmail_read_thread" | "gmail_create_draft") =>
    tools.createGmailTools("ada")[name].inputSchema as {
      safeParse: (value: unknown) => { success: boolean };
    };

  it("accepts only Gmail's own IDs, which become API path segments", () => {
    const thread = schema("gmail_read_thread");
    expect(thread.safeParse({ threadId: "19a2b3c4d5e6f708" }).success).toBe(true);
    expect(thread.safeParse({ threadId: "../drafts" }).success).toBe(false);
    expect(thread.safeParse({ threadId: "t1?format=raw" }).success).toBe(false);
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
        hasMore: true,
        messages: [
          {
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
      note: "2 results+",
      rows: [
        { primary: "Numbers", secondary: "Grace Hopper", unread: true },
        { primary: "(no subject)", secondary: "alan@example.test" },
      ],
    });
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
          subject: "Plans",
          messages: [
            {
              from: "Grace <grace@example.test>",
              body: "private words",
              attachments: [{ filename: "plan.pdf" }, { filename: "map.png" }],
            },
          ],
        },
      }),
    );
    expect(display).toMatchObject({
      title: "Read email",
      detail: "Plans",
      note: "1 message",
      rows: [{ primary: "Grace", secondary: "plan.pdf, map.png" }],
    });
    expect(JSON.stringify(display)).not.toContain("private words");
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
      note: "To grace@example.test",
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
    ).toMatchObject({ status: "done", rows: [], note: "0 results" });
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
