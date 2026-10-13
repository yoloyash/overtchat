import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), principal: vi.fn(), ticket: vi.fn(), chat: vi.fn(), generation: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/db/voiceSessions", () => ({ getVoicePrincipal: mocks.principal }));
vi.mock("@/lib/voice/ticket", () => ({ verifyVoiceTicket: mocks.ticket }));
vi.mock("@/lib/db/chats", () => ({ getChat: mocks.chat }));
vi.mock("@/lib/db/chatTurns", () => ({ getChatGenerationByRequestId: mocks.generation }));
vi.mock("@/lib/streams/cancel-registry", () => ({ cancel: mocks.cancel }));
import { POST } from "./route";
const request = () => new Request("http://test/api/voice/interrupt", { method: "POST", body: JSON.stringify({ clientRequestId: "voice:session:turn" }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "user" } });
  mocks.principal.mockReturnValue({ id: "user" });
  mocks.ticket.mockReturnValue({ sessionId: "session", chatId: "chat", userId: "user" });
  mocks.generation.mockResolvedValue({ id: "stream", chatId: "chat", status: "running" });
  mocks.chat.mockResolvedValue({ activeStreamId: "stream" });
});
it("cancels the intended generation", async () => {
  expect((await POST(request())).status).toBe(204);
  expect(mocks.cancel).toHaveBeenCalledWith("stream");
});
it("does not let a late interruption cancel the next generation", async () => {
  mocks.chat.mockResolvedValue({ activeStreamId: "next" });
  expect((await POST(request())).status).toBe(204);
  expect(mocks.cancel).not.toHaveBeenCalled();
});
it("rejects a revoked session before inspecting generations", async () => {
  mocks.principal.mockReturnValue(null);
  expect((await POST(request())).status).toBe(401);
  expect(mocks.generation).not.toHaveBeenCalled();
});
