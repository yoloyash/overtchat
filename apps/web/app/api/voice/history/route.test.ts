import { expect, it, vi } from "vitest";
const getSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession } } }));
import { POST } from "./route";
it("requires login and tells obsolete voice clients to reload", async () => {
  const request = new Request("http://app.test/api/voice/history", { method: "POST" });
  getSession.mockResolvedValue(null);
  expect((await POST(request)).status).toBe(401);
  getSession.mockResolvedValue({ user: { id: "user" } });
  expect((await POST(request)).status).toBe(410);
});
