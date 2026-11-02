import { beforeEach, describe, expect, it, vi } from "vitest";
import mammoth from "mammoth";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

import { POST } from "./route";

function exportRequest(body: unknown): Request {
  return new Request("http://localhost/api/documents/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = {
  title: "Q3: launch / plan",
  type: "markdown",
  content: "# Launch plan\n\n- Beta in **July**",
  format: "docx",
};

describe("document Word export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-id" } });
  });

  it("returns a Word file named after the document", async () => {
    const response = await POST(exportRequest(valid));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename*=UTF-8''Q3%20launch%20plan.docx",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const { value } = await mammoth.convertToHtml({
      buffer: Buffer.from(await response.arrayBuffer()),
    });
    expect(value).toBe("<h1>Launch plan</h1><ul><li>Beta in <strong>July</strong></li></ul>");
  });

  it("requires a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await POST(exportRequest(valid))).status).toBe(401);
  });

  it.each([
    ["malformed JSON", "{"],
    ["another format", { ...valid, format: "pdf" }],
    ["a non-Markdown document", { ...valid, type: "html" }],
    ["an empty title", { ...valid, title: "  " }],
    ["oversized content", { ...valid, content: "x".repeat(400_001) }],
  ])("rejects %s", async (_name, body) => {
    const response = await POST(exportRequest(body));
    expect(response.status).toBe(400);
  });
});
