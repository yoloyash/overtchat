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
import { INTEGRATIONS } from "@/lib/integrations/schema";
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
  body?: {
    message?: { raw?: string; threadId?: string };
    /** A message sent as it is, without a draft. */
    raw?: string;
    threadId?: string;
    addLabelIds?: string[];
    removeLabelIds?: string[];
  };
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
      account: "ada@example.test",
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
    ).resolves.toEqual({
      account: "ada@example.test",
      messages: [],
      hasMore: false,
    });
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
                partId: "1",
                mimeType: "application/pdf",
                filename: "plan.pdf",
                body: { attachmentId: "a1", size: 2048 },
              },
              // A logo in the signature is not something the sender attached.
              {
                partId: "2",
                mimeType: "image/png",
                filename: "image001.png",
                headers: headers({
                  "Content-ID": "<image001@example.test>",
                  "Content-Disposition": 'inline; filename="image001.png"',
                }),
                body: { attachmentId: "a2", size: 512 },
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
    expect(thread.account).toBe("ada@example.test");
    expect(thread.omittedMessages).toBe(0);
    expect(thread.messages[0]).toMatchObject({
      id: "m1",
      body: "Plain words\n\nNext",
      truncated: false,
      attachments: [
        { id: "1", filename: "plan.pdf", mediaType: "application/pdf", size: 2048 },
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

/** A one-page PDF whose only text is `text`. */
function pdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let file = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = file.length;
    file += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    file += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file, "latin1");
}

describe("attachments", () => {
  /** A message with one attached file, served by ID like Gmail does for large ones. */
  function attached(part: Record<string, unknown>, data?: Buffer) {
    return google((path) =>
      path.includes("/attachments/")
        ? { body: { data: data?.toString("base64url") } }
        : {
            body: {
              id: "m1",
              threadId: "t1",
              payload: {
                mimeType: "multipart/mixed",
                parts: [
                  { partId: "0", mimeType: "text/plain", body: { data: encode("See attached.") } },
                  { partId: "1", ...part },
                ],
              },
            },
          },
    );
  }
  const read = (offset = 0, attachmentId = "1") =>
    gmail.readGmailAttachment("ada", { messageId: "m1", attachmentId, offset });

  it("reads the text of a PDF sent without its real type", async () => {
    const file = pdf("Total due: 420 euros");
    const requests = attached(
      {
        mimeType: "application/octet-stream",
        filename: "Invoice 42.PDF",
        body: { attachmentId: "changes-every-request", size: file.length },
      },
      file,
    );

    await expect(read()).resolves.toEqual({
      messageId: "m1",
      filename: "Invoice 42.PDF",
      mediaType: "application/pdf",
      text: "Total due: 420 euros",
      offset: 0,
      totalChars: 20,
      nextOffset: null,
      pageCount: 1,
    });
    expect(requests.map((request) => request.path)).toEqual([
      "/messages/m1?format=full",
      "/messages/m1/attachments/changes-every-request",
    ]);
  });

  it("hands a long file over in parts", async () => {
    const text = "0123456789".repeat(13_000);
    attached({
      mimeType: "text/plain",
      filename: "notes.txt",
      body: { data: encode(text), size: text.length },
    });

    const first = await read();
    expect(first).toMatchObject({ offset: 0, totalChars: 130_000, nextOffset: 60_000 });
    expect(first.text).toHaveLength(60_000);
    const second = await read(first.nextOffset!);
    expect(second.nextOffset).toBe(120_000);
    const last = await read(second.nextOffset!);
    expect(last.nextOffset).toBeNull();
    expect(first.text + second.text + last.text).toBe(text);
    await expect(read(130_000)).rejects.toThrow(/nothing at offset 130000/);
  });

  it("refuses an image or an oversized file before downloading it", async () => {
    const image = attached({
      mimeType: "image/png",
      filename: "photo.png",
      body: { attachmentId: "a1", size: 1024 },
    });
    await expect(read()).rejects.toThrow("photo.png is an image");
    expect(image).toHaveLength(1);
    vi.restoreAllMocks();

    const huge = attached({
      mimeType: "application/pdf",
      filename: "scan.pdf",
      body: { attachmentId: "a1", size: 20 * 1024 * 1024 },
    });
    await expect(read()).rejects.toThrow(
      "scan.pdf is 20.0 MB. Attachments over 15.0 MB cannot be read.",
    );
    expect(huge).toHaveLength(1);
  });

  it("explains a file it cannot read, or one that is not there", async () => {
    attached(
      {
        mimeType: "application/zip",
        filename: "archive.zip",
        body: { attachmentId: "a1", size: 4 },
      },
      Buffer.from("PK\u0003\u0004"),
    );
    await expect(read()).rejects.toThrow(
      "archive.zip is a kind of file that cannot be read.",
    );
    await expect(read(0, "7")).rejects.toMatchObject({ status: 404 });
  });
});

describe("labels", () => {
  const labels = [
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "UNREAD", name: "UNREAD", type: "system" },
    { id: "TRASH", name: "TRASH", type: "system" },
    { id: "SPAM", name: "SPAM", type: "system" },
    { id: "CATEGORY_PROMOTIONS", name: "CATEGORY_PROMOTIONS", type: "system" },
    { id: "Label_7", name: "Receipts", type: "user" },
    { id: "Label_2", name: "Family", type: "user" },
  ];
  const mailbox = () =>
    google((path) => (path === "/labels" ? { body: { labels } } : { body: {} }));

  it("lists the labels that sort mail, then Gmail's others, then the user's own", async () => {
    mailbox();
    await expect(gmail.listGmailLabels("ada")).resolves.toEqual({
      labels: [
        { id: "INBOX", name: "INBOX", type: "system" },
        { id: "UNREAD", name: "UNREAD", type: "system" },
        { id: "STARRED", name: "STARRED", type: "system" },
        { id: "IMPORTANT", name: "IMPORTANT", type: "system" },
        { id: "TRASH", name: "TRASH", type: "system" },
        { id: "SPAM", name: "SPAM", type: "system" },
        { id: "CATEGORY_PROMOTIONS", name: "CATEGORY_PROMOTIONS", type: "system" },
        { id: "Label_2", name: "Family", type: "user" },
        { id: "Label_7", name: "Receipts", type: "user" },
      ],
    });
  });

  it("archives, marks read and labels whole threads by label name or ID", async () => {
    const requests = mailbox();

    await expect(
      gmail.modifyGmailLabels("ada", {
        threadIds: ["t1", "t2", "t1"],
        add: ["receipts", "STARRED"],
        remove: ["INBOX", "unread"],
      }),
    ).resolves.toEqual({
      account: "ada@example.test",
      threads: 2,
      added: ["Receipts", "STARRED"],
      removed: ["INBOX", "UNREAD"],
    });

    const changes = requests.filter((request) => request.method === "POST");
    expect(changes.map((request) => request.path)).toEqual([
      "/threads/t1/modify",
      "/threads/t2/modify",
    ]);
    for (const change of changes) {
      expect(change.body).toEqual({
        addLabelIds: ["Label_7", "STARRED"],
        removeLabelIds: ["INBOX", "UNREAD"],
      });
    }
  });

  it("moves threads to the trash, reports spam and changes Gmail's other labels", async () => {
    const requests = mailbox();
    const modify = (add: string[], remove: string[] = []) =>
      gmail.modifyGmailLabels("ada", { threadIds: ["t1"], add, remove });

    await expect(modify(["trash"])).resolves.toMatchObject({ added: ["TRASH"] });
    await expect(modify(["SPAM"], ["CATEGORY_PROMOTIONS"])).resolves.toMatchObject({
      added: ["SPAM"],
      removed: ["CATEGORY_PROMOTIONS"],
    });
    expect(
      requests.filter((request) => request.method === "POST").map((request) => request.body),
    ).toEqual([
      { addLabelIds: ["TRASH"], removeLabelIds: [] },
      { addLabelIds: ["SPAM"], removeLabelIds: ["CATEGORY_PROMOTIONS"] },
    ]);
  });

  it("says how many threads changed when Gmail fails partway", async () => {
    google((path) =>
      path === "/labels"
        ? { body: { labels } }
        : path === "/threads/t6/modify"
          ? { status: 429, body: {} }
          : { body: {} },
    );
    const threadIds = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];

    await expect(
      gmail.modifyGmailLabels("ada", { threadIds, add: [], remove: ["INBOX"] }),
    ).rejects.toThrow(
      "6 of 7 threads were changed before this failed: Gmail is limiting requests for this account. Try again in a minute.",
    );
    // Nothing changed, so the error stands as Gmail gave it.
    await expect(
      gmail.modifyGmailLabels("ada", { threadIds: ["t6"], add: [], remove: ["INBOX"] }),
    ).rejects.toThrow(/^Gmail is limiting requests/);
  });

  it("refuses a label that does not exist or a change that cancels itself", async () => {
    const requests = mailbox();
    const modify = (add: string[], remove: string[] = []) =>
      gmail.modifyGmailLabels("ada", { threadIds: ["t1"], add, remove });

    await expect(modify(["Holidays"])).rejects.toThrow(/no label named "Holidays"/);
    await expect(modify(["Receipts"], ["Label_7"])).rejects.toThrow(/both added and removed/);
    await expect(modify([])).rejects.toThrow(/at least one label/);
    expect(requests.some((request) => request.method === "POST")).toBe(false);
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

  const original = {
    body: {
      id: "m1",
      threadId: "t1",
      payload: {
        headers: headers({
          From: "Grace Hopper <grace@example.test>",
          Subject: "Quarterly numbers",
          "Message-ID": "<abc@mail.example.test>",
        }),
      },
    },
  };

  it("composes an email without saving or sending anything", async () => {
    const requests = google(() => original);

    const email = await gmail.composeGmailEmail("ada", {
      to: [],
      cc: [],
      bcc: [],
      body: "Thanks, looks right.",
      replyToMessageId: "m1",
    });

    // Only the message it answers is read, for what a reply inherits.
    expect(requests.map((r) => r.method)).toEqual(["GET"]);
    expect(email).toEqual({
      emailId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      threadId: "t1",
      account: "ada@example.test",
      to: "grace@example.test",
      subject: "Re: Quarterly numbers",
      status: "not_sent",
    });
    await expect(
      gmail.composeGmailEmail("ada", { to: [], cc: [], bcc: [], body: "Hi" }),
    ).rejects.toThrow(/recipient/);
  });

  it("sends an email as written, in the thread it answers", async () => {
    const requests = google((path) =>
      path.startsWith("/messages/m1") ? original : { body: { id: "m9", threadId: "t1" } },
    );

    const sentEmail = await gmail.sendGmailEmail("ada", {
      to: [],
      cc: ["alan@example.test"],
      bcc: [],
      body: "Thanks, looks right.",
      replyToMessageId: "m1",
    });

    expect(sentEmail).toEqual({ threadId: "t1" });
    const send = requests.find((r) => r.path === "/messages/send")!;
    expect(send.method).toBe("POST");
    expect(send.body!.threadId).toBe("t1");
    const [head, body] = Buffer.from(send.body!.raw!, "base64url")
      .toString("utf8")
      .split("\r\n\r\n");
    expect(head.split("\r\n")).toEqual(
      expect.arrayContaining([
        "To: grace@example.test",
        "Cc: alan@example.test",
        "Subject: Re: Quarterly numbers",
        "In-Reply-To: <abc@mail.example.test>",
      ]),
    );
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Thanks, looks right.");
    expect(requests.some((r) => r.path.startsWith("/drafts"))).toBe(false);
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
    ).resolves.toEqual({
      account: "ada@example.test",
      messages: [],
      hasMore: false,
    });
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
    ).rejects.toThrow(
      "The Gmail sign-in has ended. Reconnect Gmail in the OvertChat web app under Settings → Tools → Connectors.",
    );
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
