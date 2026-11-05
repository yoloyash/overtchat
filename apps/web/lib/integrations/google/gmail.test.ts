import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createIntegrationTestDatabase } from "@/lib/integrations/test-database";

vi.mock("server-only", () => ({}));

const database = createIntegrationTestDatabase("gmail-client");
let repository: typeof import("@/lib/db/integrations");
let gmail: typeof import("./gmail");

type Answer = { status?: number; body: unknown };

/** Stands in for Gmail and Google's token endpoint, answering by path. */
function google(route: (path: string, request: Recorded) => Answer) {
  const requests: Recorded[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const request: Recorded = {
      path: `${url.pathname.replace("/gmail/v1/users/me", "")}${url.search}`,
      method: init?.method ?? "GET",
      authorization: (init?.headers as Record<string, string>)?.Authorization,
      body:
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const answer = route(request.path, request);
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
    });
  });
  return requests;
}
interface Recorded {
  path: string;
  method: string;
  authorization?: string;
  body?: { message?: { raw?: string; threadId?: string } };
}

const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const headers = (values: Record<string, string>) =>
  Object.entries(values).map(([name, value]) => ({ name, value }));

beforeAll(async () => {
  repository = await import("@/lib/db/integrations");
  gmail = await import("./gmail");
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

describe("search", () => {
  it("lists matches and summarizes each from its headers", async () => {
    const requests = google((path) =>
      path.startsWith("/messages?")
        ? { body: { messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "more" } }
        : {
            body: {
              id: path.slice(10, 12),
              threadId: "t1",
              labelIds: path.includes("m1") ? ["INBOX", "UNREAD"] : ["INBOX"],
              snippet: "Tom &amp; Jerry&#39;s invoice",
              internalDate: "1762250400000",
              payload: {
                headers: headers({
                  From: "Ada <ada@example.test>",
                  To: "grace@example.test",
                  Subject: "Invoice 42",
                }),
              },
            },
          },
    );

    const result = await gmail.searchGmail("ada", {
      query: "subject:invoice newer_than:7d",
      limit: 5,
    });

    expect(requests[0].path).toBe(
      "/messages?q=subject%3Ainvoice+newer_than%3A7d&maxResults=5",
    );
    expect(requests[1].path).toBe(
      "/messages/m1?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date",
    );
    expect(requests.every((r) => r.authorization === "Bearer access-1")).toBe(true);
    expect(result).toEqual({
      hasMore: true,
      messages: [
        {
          id: "m1",
          threadId: "t1",
          from: "Ada <ada@example.test>",
          to: "grace@example.test",
          subject: "Invoice 42",
          date: "2025-11-04T10:00:00.000Z",
          snippet: "Tom & Jerry's invoice",
          unread: true,
        },
        expect.objectContaining({ id: "m2", unread: false }),
      ],
    });
  });

  it("returns nothing when no mail matches", async () => {
    google(() => ({ body: { resultSizeEstimate: 0 } }));
    await expect(
      gmail.searchGmail("ada", { query: "from:nobody", limit: 5 }),
    ).resolves.toEqual({ messages: [], hasMore: false });
  });
});

describe("reading a thread", () => {
  const message = (id: string, payload: object) => ({
    id,
    threadId: "t1",
    internalDate: "1762250400000",
    payload: {
      headers: headers({ From: "ada@example.test", Subject: "Plans" }),
      ...payload,
    },
  });

  it("prefers plain text, falls back to HTML, and lists attachments by name", async () => {
    google(() => ({
      body: {
        id: "t1",
        messages: [
          message("m1", {
            mimeType: "multipart/mixed",
            parts: [
              {
                mimeType: "multipart/alternative",
                parts: [
                  { mimeType: "text/plain", body: { data: encode("Plain  words\r\n\r\n\r\n\r\nNext") } },
                  { mimeType: "text/html", body: { data: encode("<b>HTML words</b>") } },
                ],
              },
              {
                mimeType: "application/pdf",
                filename: "plan.pdf",
                body: { attachmentId: "a1", size: 2048 },
              },
            ],
          }),
          message("m2", {
            mimeType: "text/html",
            body: {
              data: encode(
                "<style>p{color:red}</style><p>Hello <b>Ada</b>,</p><div>See you&nbsp;there.</div><script>alert(1)</script>",
              ),
            },
          }),
        ],
      },
    }));

    const thread = await gmail.readGmailThread("ada", "t1");

    expect(thread.subject).toBe("Plans");
    expect(thread.omittedMessages).toBe(0);
    expect(thread.messages[0]).toMatchObject({
      id: "m1",
      body: "Plain words\n\nNext",
      truncated: false,
      attachments: [
        { filename: "plan.pdf", mediaType: "application/pdf", size: 2048 },
      ],
    });
    expect(thread.messages[1].body).toBe("Hello Ada,\nSee you there.");
  });

  it("decodes a body in the charset its part declares", async () => {
    google(() => ({
      body: {
        id: "t1",
        messages: [
          message("m1", {
            mimeType: "text/plain",
            headers: headers({
              Subject: "Plans",
              "Content-Type": 'text/plain; charset="iso-8859-1"',
            }),
            body: { data: Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString("base64url") },
          }),
        ],
      },
    }));
    expect((await gmail.readGmailThread("ada", "t1")).messages[0].body).toBe(
      "café",
    );
  });

  it("cuts long messages and drops the oldest of an overlong thread", async () => {
    google(() => ({
      body: {
        id: "t1",
        messages: ["m1", "m2", "m3", "m4"].map((id) =>
          message(id, {
            mimeType: "text/plain",
            body: { data: encode(`${id} ${"x".repeat(25_000)}`) },
          }),
        ),
      },
    }));

    const thread = await gmail.readGmailThread("ada", "t1");

    expect(thread.messages.map((item) => item.id)).toEqual(["m2", "m3", "m4"]);
    expect(thread.omittedMessages).toBe(1);
    expect(thread.messages.every((item) => item.truncated)).toBe(true);
    expect(thread.messages.at(-1)!.body).toHaveLength(20_000);
    expect(
      thread.messages.reduce((total, item) => total + item.body.length, 0),
    ).toBeLessThanOrEqual(60_000);
  });
});

describe("drafts", () => {
  function sent(requests: Recorded[]) {
    const draft = requests.find((r) => r.path === "/drafts")!;
    const mime = Buffer.from(draft.body!.message!.raw!, "base64url").toString("utf8");
    const [head, body] = mime.split("\r\n\r\n");
    return {
      threadId: draft.body!.message!.threadId,
      head: head.split("\r\n"),
      body: Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"),
    };
  }

  it("saves a new message as a draft and never sends it", async () => {
    const requests = google(() => ({
      body: { id: "d1", message: { id: "m9", threadId: "t9" } },
    }));

    const draft = await gmail.createGmailDraft("ada", {
      to: ["grace@example.test", "alan@example.test"],
      cc: ["team@example.test"],
      bcc: [],
      subject: "Déjeuner jeudi",
      body: "Bonjour,\n\nÀ jeudi ?\n" + "ligne ".repeat(40),
    });

    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /drafts"]);
    const message = sent(requests);
    expect(message.threadId).toBeUndefined();
    expect(message.head).toEqual([
      "To: grace@example.test, alan@example.test",
      "Cc: team@example.test",
      `Subject: =?UTF-8?B?${Buffer.from("Déjeuner jeudi").toString("base64")}?=`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ]);
    expect(message.body).toBe("Bonjour,\n\nÀ jeudi ?\n" + "ligne ".repeat(40));
    expect(draft).toEqual({
      draftId: "d1",
      threadId: "t9",
      account: "ada@example.test",
      to: "grace@example.test, alan@example.test",
      subject: "Déjeuner jeudi",
    });
  });

  it("threads a reply and takes its recipient and subject from the original", async () => {
    const requests = google((path) =>
      path.startsWith("/messages/m1")
        ? {
            body: {
              id: "m1",
              threadId: "t1",
              payload: {
                headers: headers({
                  From: "Grace Hopper <grace@example.test>",
                  Subject: "Quarterly numbers",
                  "Message-ID": "<abc@mail.example.test>",
                  References: "<root@mail.example.test>",
                }),
              },
            },
          }
        : { body: { id: "d2", message: { threadId: "t1" } } },
    );

    const draft = await gmail.createGmailDraft("ada", {
      to: [],
      cc: [],
      bcc: [],
      body: "Thanks, looks right.",
      replyToMessageId: "m1",
    });

    const message = sent(requests);
    expect(message.threadId).toBe("t1");
    expect(message.head).toEqual(
      expect.arrayContaining([
        "To: grace@example.test",
        "Subject: Re: Quarterly numbers",
        "In-Reply-To: <abc@mail.example.test>",
        "References: <root@mail.example.test> <abc@mail.example.test>",
      ]),
    );
    expect(draft).toMatchObject({ to: "grace@example.test", threadId: "t1" });
  });

  it("refuses a draft with nobody to send to, or a new one with no subject", async () => {
    const requests = google(() => ({ body: {} }));
    const base = { cc: [], bcc: [], body: "Hi" };

    await expect(
      gmail.createGmailDraft("ada", { ...base, to: [], subject: "Hello" }),
    ).rejects.toThrow(/recipient/);
    await expect(
      gmail.createGmailDraft("ada", { ...base, to: ["grace@example.test"] }),
    ).rejects.toThrow(/subject/);
    expect(requests).toHaveLength(0);
  });

  it("cannot be made to add headers through a recipient or subject", () => {
    expect(() =>
      gmail.buildDraftMessage({
        to: ["grace@example.test\r\nBcc: thief@example.test"],
        cc: [],
        bcc: [],
        subject: "Hello",
        body: "Hi",
      }),
    ).toThrow(/line breaks/);
  });
});

describe("failures", () => {
  it("refreshes a token Gmail refuses and repeats the request once", async () => {
    let refreshed = false;
    const requests = google((path, request) => {
      if (path === "/token") {
        refreshed = true;
        return { body: { access_token: "access-2", expires_in: 3600 } };
      }
      return request.authorization === "Bearer access-2"
        ? { body: { messages: [] } }
        : { status: 401, body: {} };
    });

    await expect(
      gmail.searchGmail("ada", { query: "in:inbox", limit: 5 }),
    ).resolves.toEqual({ messages: [], hasMore: false });
    expect(refreshed).toBe(true);
    expect(requests).toHaveLength(3);
    expect(repository.getIntegrationConnection("ada", "gmail")).toMatchObject({
      accessToken: "access-2",
      status: "connected",
    });
  });

  it("asks for a new sign-in when the grant behind a refused token is gone", async () => {
    google((path) =>
      path === "/token"
        ? { status: 400, body: { error: "invalid_grant" } }
        : { status: 401, body: {} },
    );

    await expect(
      gmail.searchGmail("ada", { query: "in:inbox", limit: 5 }),
    ).rejects.toThrow(/reconnected in Settings/);
    expect(repository.getIntegrationConnection("ada", "gmail")?.status).toBe(
      "needs_reconnect",
    );
  });

  it.each([
    [404, {}, /no message or thread with that ID/],
    [429, {}, /limiting requests/],
    [403, { error: { message: "Gmail API has not been used" } }, /Gmail API has not been used/],
    [500, {}, /returned an error/],
  ])("explains a %i from Gmail", async (status, body, message) => {
    google(() => ({ status, body }));
    await expect(gmail.readGmailThread("ada", "t1")).rejects.toThrow(message);
  });
});
