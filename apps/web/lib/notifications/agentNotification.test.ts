import { describe, expect, it } from "vitest";
import {
  agentNotificationHeading,
  agentNotificationText,
  isAgentNotification,
} from "./agentNotification";

const session = { title: "Fix tests", workspaceName: "app", hostName: "This machine" };

describe("agent notification text", () => {
  it("names the state and the session, then says what was asked", () => {
    expect(
      agentNotificationText(
        {
          reason: "approval",
          attention: { kind: "approval", id: "r", requestedAt: 1, title: "Allow Bash", detail: "npm ci" },
        },
        session,
      ),
    ).toEqual({ title: "Needs approval: Fix tests", body: "Allow Bash · npm ci" });
    expect(
      agentNotificationText(
        { reason: "question", attention: { kind: "question", id: "r", requestedAt: 1, title: "Which branch?" } },
        session,
      ),
    ).toEqual({ title: "Has a question: Fix tests", body: "Which branch?" });
  });

  it("shows the reply or the error, else where the session runs", () => {
    expect(
      agentNotificationText(
        { reason: "completed", turn: { outcome: "completed", startedAt: 1, endedAt: 2, preview: "Done.\n\nAll green." } },
        session,
      ).body,
    ).toBe("Done. All green.");
    expect(
      agentNotificationText(
        { reason: "failed", turn: { outcome: "failed", startedAt: 1, endedAt: 2, error: "Rate limit reached" } },
        session,
      ),
    ).toEqual({ title: "Failed: Fix tests", body: "Rate limit reached" });
    expect(
      agentNotificationText({ reason: "completed", turn: { outcome: "completed", startedAt: 1, endedAt: 2 } }, session).body,
    ).toBe("app · This machine");
  });

  it("keeps a long reply to a glance", () => {
    const { body } = agentNotificationText(
      { reason: "completed", turn: { outcome: "completed", startedAt: 1, endedAt: 2, preview: "word ".repeat(80) } },
      session,
    );
    expect(body.length).toBe(160);
    expect(body.endsWith("…")).toBe(true);
  });

  it("takes a title apart into the state and the session", () => {
    const { title } = agentNotificationText({ reason: "completed" }, session);
    expect(agentNotificationHeading({ reason: "completed", title })).toEqual({
      label: "Finished",
      session: "Fix tests",
    });
    // A title in another shape is shown whole.
    expect(
      agentNotificationHeading({ reason: "failed", title: "An agent failed" }),
    ).toEqual({ label: "An agent failed" });
  });

  it("recognizes what the stream carries", () => {
    const notification = { sessionId: "s", reason: "completed", eventId: "e", title: "t", body: "b", provider: "codex" };
    expect(isAgentNotification(notification)).toBe(true);
    expect(isAgentNotification({ ...notification, reason: "idle" })).toBe(false);
    expect(isAgentNotification({ ...notification, sessionId: "" })).toBe(false);
    expect(isAgentNotification(null)).toBe(false);
  });
});
