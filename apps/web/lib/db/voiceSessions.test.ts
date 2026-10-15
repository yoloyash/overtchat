import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./client", () => fixture);
const raw = new Database(":memory:");
raw.pragma("foreign_keys = ON");
fixture.db = drizzle(raw);
migrate(fixture.db as ReturnType<typeof drizzle>, { migrationsFolder: path.resolve("drizzle") });
const sessions = await import("./voiceSessions");
const { deleteChat } = await import("./chats");
const { commitChatTurn, completeChatStream } = await import("./chatTurns");
const cancellation = await import("@/lib/streams/cancel-registry");
afterAll(() => raw.close());
beforeEach(() => {
  raw.exec(`DELETE FROM chats; DELETE FROM user;
    INSERT INTO user (id,name,email,role) VALUES ('owner','Owner','owner@example.test','admin'), ('other','Other','other@example.test','user');
    INSERT INTO chats (id,user_id,title,kind) VALUES ('chat','owner','Existing','text'), ('legacy','owner','Voice','voice');`);
  raw.prepare("INSERT INTO session (id,token,user_id,expires_at,updated_at) VALUES ('login','token','owner',?,?)").run(Date.now() + 60000, Date.now());
});
describe("voice session leases", () => {
  it("does not cancel a new text turn when an expired voice connection ends", () => {
    const id = sessions.claimVoiceSession("chat", "owner", "login")!;
    raw.exec("UPDATE voice_sessions SET expires_at=0");
    expect(commitChatTurn({
      chatId: "chat", userId: "owner", projectId: null, streamId: "new-text",
      clientRequestId: "text-request", requestFingerprint: "text", staleStreamId: null,
      userMessage: { id: "typed", parts: [{ type: "text", text: "A new text turn" }] },
    })).toBe("committed");
    const controller = new AbortController();
    cancellation.register("new-text", controller);
    try {
      sessions.endVoiceSession(id, "owner");
      expect(controller.signal.aborted).toBe(false);
      expect(raw.prepare("SELECT count(*) AS n FROM voice_sessions").get()).toEqual({ n: 0 });
      expect(completeChatStream({ chatId: "chat", streamId: "new-text", status: "complete" })).toBe(true);
    } finally { cancellation.unregister("new-text"); }
  });

  it.each([false, true])("still cancels its own generation when the lease is expired=%s", expired => {
    const id = sessions.claimVoiceSession("chat", "owner", "login")!;
    expect(commitChatTurn({
      chatId: "chat", userId: "owner", projectId: null, streamId: "spoken",
      clientRequestId: `voice:${id}:turn`, requestFingerprint: "voice", staleStreamId: null,
      voiceSessionId: id,
      userMessage: { id: "spoken-user", parts: [{ type: "text", text: "A voice turn" }] },
    })).toBe("committed");
    if (expired) raw.exec("UPDATE voice_sessions SET expires_at=0");
    const controller = new AbortController();
    cancellation.register("spoken", controller);
    try {
      sessions.endVoiceSession(id, "owner");
      expect(controller.signal.aborted).toBe(true);
    } finally { cancellation.unregister("spoken"); }
  });

  it("leases any chat kind without creating or rewriting messages", () => {
    for (const chatId of ["chat", "legacy", "new"]) {
      const id = sessions.claimVoiceSession(chatId, "owner", "login");
      expect(id).toBeTruthy();
      expect(sessions.getVoicePrincipal(id!, chatId, "owner")).toEqual({ id: "owner", role: "admin" });
    }
    expect(raw.prepare("SELECT id,kind FROM chats ORDER BY id").all()).toEqual([{ id: "chat", kind: "text" }, { id: "legacy", kind: "voice" }]);
    expect(raw.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 0 });
  });
  it("rejects competing connections, other users, and active text generation", () => {
    expect(sessions.claimVoiceSession("chat", "other", "login")).toBeNull();
    expect(sessions.claimVoiceSession("chat", "owner", "login")).toBeTruthy();
    expect(sessions.claimVoiceSession("chat", "owner", "login")).toBeNull();
    raw.exec("UPDATE chats SET active_stream_id='stream' WHERE id='legacy'");
    expect(sessions.claimVoiceSession("legacy", "owner", "login")).toBeNull();
  });
  it("expires and fences previous connections without allowing a late End to end the replacement", () => {
    const first = sessions.claimVoiceSession("chat", "owner", "login")!;
    raw.exec("UPDATE voice_sessions SET expires_at=0");
    sessions.renewVoiceSession(first);
    expect(sessions.getVoicePrincipal(first, "chat", "owner")).toBeNull();
    const second = sessions.claimVoiceSession("chat", "owner", "login")!;
    sessions.endVoiceSession(first, "owner");
    expect(sessions.getVoicePrincipal(second, "chat", "owner")).toBeTruthy();
    sessions.endVoiceSession(second, "other");
    expect(sessions.getVoicePrincipal(second, "chat", "owner")).toBeTruthy();
    sessions.endVoiceSession(second, "owner");
    expect(sessions.getVoicePrincipal(second, "chat", "owner")).toBeNull();
  });
  it("revokes access on logout, bans, and chat deletion", async () => {
    const id = sessions.claimVoiceSession("chat", "owner", "login")!;
    raw.exec("UPDATE user SET banned=1 WHERE id='owner'");
    expect(sessions.getVoicePrincipal(id, "chat", "owner")).toBeNull();
    raw.exec("UPDATE user SET banned=0 WHERE id='owner'");
    await deleteChat("chat", "other");
    expect(sessions.getVoicePrincipal(id, "chat", "owner")).toBeTruthy();
    await deleteChat("chat", "owner");
    expect(sessions.getVoicePrincipal(id, "chat", "owner")).toBeNull();
    const next = sessions.claimVoiceSession("legacy", "owner", "login")!;
    raw.exec("DELETE FROM session WHERE id='login'");
    expect(sessions.getVoicePrincipal(next, "legacy", "owner")).toBeNull();
  });
});
