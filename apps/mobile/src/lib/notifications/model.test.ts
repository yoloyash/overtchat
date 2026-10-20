import { describe, expect, it } from "vitest";
import { parseNotificationTarget, viewedTarget } from "./model";

describe("notification routing", () => {
  const target = {
    kind: "chat",
    targetId: "chat-id",
    registrationId: "device",
    notificationId: "notification",
  };
  it("accepts only the active server/account registration", () => {
    expect(parseNotificationTarget(target, "device")).toEqual(target);
    expect(parseNotificationTarget(target, "other-server-device")).toBeNull();
  });
  it.each([
    null,
    {},
    { ...target, kind: "url" },
    { ...target, targetId: "https://evil.invalid" },
    { ...target, targetId: "../settings" },
    { ...target, targetId: "" },
    { ...target, notificationId: 2 },
  ])("rejects invalid notification data", (data) => {
    expect(parseNotificationTarget(data, "device")).toBeNull();
  });
  it("identifies only the chat or agent actually on screen", () => {
    expect(viewedTarget("/chat", "chat-id")).toBe("chat:chat-id");
    expect(viewedTarget("/agents/agent-id", "chat-id")).toBe("agent:agent-id");
    for (const route of [
      "/settings",
      "/agents",
      "/agents/new",
      "/agents/workspace",
    ]) {
      expect(viewedTarget(route, "chat-id")).toBeNull();
    }
  });
});
