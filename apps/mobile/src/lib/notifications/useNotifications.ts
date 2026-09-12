import * as Notifications from "expo-notifications";
import * as Network from "expo-network";
import { router, usePathname } from "expo-router";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { getAuthClient } from "@/lib/auth/client";
import { getApiBase, getAuthCookie } from "@/lib/api";
import type { ChatSession } from "@/lib/chat/session";
import {
  clearActiveNotificationScope,
  notificationSettings,
  setActiveNotificationScope,
  syncNotifications,
  showNotificationIntro,
} from "./client";
import { parseNotificationTarget, viewedTarget } from "./model";

export function useNotifications(chat: ChatSession) {
  const login = getAuthClient().useSession();
  const server = getApiBase();
  const userId = login.data?.user.id;
  const cookie = getAuthCookie();
  const scope = useMemo(
    () => (userId ? { server, userId, cookie } : undefined),
    [server, userId, cookie],
  );
  const pathname = usePathname();
  const viewing = viewedTarget(pathname, chat.activeChatId);
  useEffect(() => {
    if (!scope) return;
    setActiveNotificationScope(scope, viewing);
    return () => clearActiveNotificationScope(scope);
  }, [scope, viewing]);

  useEffect(() => {
    if (!scope) return;
    showNotificationIntro(scope);
    void syncNotifications(scope);
    const state = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        showNotificationIntro(scope);
        void syncNotifications(scope);
      }
    });
    const network = Network.addNetworkStateListener((next) => {
      if (
        AppState.currentState === "active" &&
        next.isConnected &&
        next.isInternetReachable !== false
      )
        void syncNotifications(scope);
    });
    const token = Notifications.addPushTokenListener(() => {
      void syncNotifications(scope);
    });
    return () => {
      state.remove();
      network.remove();
      token.remove();
    };
  }, [scope]);

  useEffect(() => {
    if (!scope) return;
    let handled: string | undefined;
    function open(response: Notifications.NotificationResponse) {
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER)
        return;
      const target = parseNotificationTarget(
        response.notification.request.content.data,
        notificationSettings(scope!).id,
      );
      if (!target || handled === response.notification.request.identifier)
        return;
      handled = response.notification.request.identifier;
      Notifications.clearLastNotificationResponse();
      if (target.kind === "chat") {
        chat.openChat(target.targetId);
        router.push("/(authed)/(drawer)/chat");
      } else {
        router.push({
          pathname: "/(authed)/agents/[id]",
          params: { id: target.targetId },
        });
      }
    }
    const listener =
      Notifications.addNotificationResponseReceivedListener(open);
    const response = Notifications.getLastNotificationResponse();
    if (response) open(response);
    return () => listener.remove();
  }, [scope, chat.openChat]);
}
