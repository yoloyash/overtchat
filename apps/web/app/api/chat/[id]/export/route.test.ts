import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  exportChat: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/export", () => ({ exportChat: mocks.exportChat }));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "chat" }) };
const payload = {
  format: "overtchat",
  version: 3,
  exportedAt: "2026-11-05T18:20:00.000Z",
  chats: [
    {
      id: "chat",
      title: "Trip plan: Lisbon!",
      kind: "text",
      createdAt: "2026-11-05T17:00:00.000Z",
      updatedAt: "2026-11-05T17:05:00.000Z",
      messages: [
        {
          id: "q",
          role: "user",
          parts: [{ type: "text", text: "Where should I go?" }],
          createdAt: "2026-11-05T17:03:00.000Z",
        },
      ],
    },
  ],
};

function get(query = "") {
  return GET(
    new Request(`http://server.test/api/chat/chat/export${query}`),
    context,
  );
}

describe("chat export route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.exportChat.mockResolvedValue(payload);
  });

  it("downloads JSON by default", async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(mocks.exportChat).toHaveBeenCalledWith("chat", "user");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="trip-plan-lisbon.json"',
    );
    await expect(response.json()).resolves.toEqual(payload);
  });

  it("downloads Markdown with times in the requested zone", async () => {
    const response = await get("?format=markdown&timeZone=Asia%2FKolkata");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="trip-plan-lisbon.md"',
    );
    await expect(response.text()).resolves.toBe(
      [
        "# Trip plan: Lisbon!",
        "*Exported on 2026-11-05 23:50. Times are in Asia/Kolkata.*",
        "## You",
        "*2026-11-05 22:33*",
        "Where should I go?",
      ].join("\n\n") + "\n",
    );
  });

  it("falls back to UTC for a missing or unknown time zone", async () => {
    for (const query of ["?format=markdown", "?format=markdown&timeZone=Nowhere%2FMade-up"]) {
      await expect((await get(query)).text()).resolves.toContain(
        "*Exported on 2026-11-05 18:20. Times are in UTC.*",
      );
    }
  });

  it("rejects an unknown format without loading the chat", async () => {
    const response = await get("?format=pdf");

    expect(response.status).toBe(400);
    expect(mocks.exportChat).not.toHaveBeenCalled();
  });

  it("requires a session and an owned chat", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await get("?format=markdown")).status).toBe(401);

    mocks.exportChat.mockResolvedValueOnce(null);
    expect((await get("?format=markdown")).status).toBe(404);
  });
});
