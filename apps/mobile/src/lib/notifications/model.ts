export type NotificationTarget = {
  kind: "chat" | "agent";
  targetId: string;
  registrationId: string;
  notificationId: string;
};

export function parseNotificationTarget(
  data: unknown,
  registrationId: string,
): NotificationTarget | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (
    (value.kind !== "chat" && value.kind !== "agent") ||
    value.registrationId !== registrationId ||
    typeof value.targetId !== "string" ||
    !/^[A-Za-z0-9_-]{1,160}$/.test(value.targetId) ||
    typeof value.notificationId !== "string" ||
    value.notificationId.length > 400
  )
    return null;
  return value as NotificationTarget;
}

export function viewedTarget(
  pathname: string,
  activeChatId: string,
): string | null {
  if (pathname === "/chat") return `chat:${activeChatId}`;
  const agent = /^\/agents\/([^/]+)$/.exec(pathname);
  if (agent && agent[1] !== "new" && agent[1] !== "workspace")
    return `agent:${agent[1]}`;
  return null;
}
