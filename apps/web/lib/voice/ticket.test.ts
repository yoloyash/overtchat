import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { issueVoiceTicket, verifyVoiceTicket } from "./ticket";

const now = Date.UTC(2026, 7, 30, 12, 0, 0);
const payload = {
  userId: "user-1",
  chatId: "chat-1",
  projectId: null,
  newChat: true,
  historyThroughRowId: null,
  modelConfigId: "model-1",
  webSearchEnabled: true,
  timeZone: "America/Los_Angeles",
};

describe("voice tickets", () => {
  beforeEach(() => vi.stubEnv("VOICE_SHARED_SECRET", "test-voice-secret"));
  afterEach(() => vi.unstubAllEnvs());

  it("uses a short connection window and a longer active-session lifetime", () => {
    const issued = issueVoiceTicket(payload, now);
    const verified = verifyVoiceTicket(issued.token, now + 3 * 60 * 60 * 1_000);

    expect(issued.connectBy).toBe(Math.floor(now / 1_000) + 120);
    expect(issued.expiresAt).toBe(Math.floor(now / 1_000) + 8 * 60 * 60);
    expect(verified).toMatchObject(payload);
  });

  it("rejects tampering and expired sessions", () => {
    const issued = issueVoiceTicket(payload, now);
    const tampered = `${issued.token.slice(0, -1)}x`;

    expect(verifyVoiceTicket(tampered, now)).toBeNull();
    expect(verifyVoiceTicket(issued.token, now + 9 * 60 * 60 * 1_000)).toBeNull();
  });
});
