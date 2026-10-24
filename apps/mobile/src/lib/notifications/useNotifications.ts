import * as Notifications from "expo-notifications";
import * as Network from "expo-network";
import { router, usePathname } from "expo-router";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { getAuthClient } from "@/lib/auth/client";
import { getApiBase } from "@/lib/api";
import { useAuthCookie } from "@/lib/auth/useAuthCookie";
import type { ChatSession } from "@/lib/chat/session";
import {
  clearActiveNotificationScope,
  notificationSettings,
  setActiveNotificationScope,
  syncNotifications,
  showNotificationIntro,
} from "./client";
import { parseNotificationTarget, viewedTarget } from "./model";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries/keys";
import { showSignInRequest } from "@/lib/queries/signInRequests";

export function useNotifications(chat: ChatSession) {
  const queryClient = useQueryClient();
  const login = getAuthClient().useSession();
  const server = getApiBase();
  const userId = login.data?.user.id;
  const cookie = useAuthCookie();
  const scope = useMemo(
    () => (userId && cookie ? { server, userId, cookie } : undefined),
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
      if (target.kind === "sign-in") {
        showSignInRequest(target.targetId, { again: true });
      } else if (target.kind === "chat") {
        chat.openChat(target.targetId);
        router.push("/(authed)/(drawer)/chat");
      } else {
        router.push({
          pathname: "/agents/[id]",
          params: { id: target.targetId },
        });
      }
    }
    const listener =
      Notifications.addNotificationResponseReceivedListener(open);
    const response = Notifications.getLastNotificationResponse();
    if (response) open(response);
    // A sign-in request arriving while the app is open is shown in the app
    // instead of as a banner; check for it now rather than at the next poll.
    const received = Notifications.addNotificationReceivedListener(
      (notification) => {
        const target = parseNotificationTarget(
          notification.request.content.data,
          notificationSettings(scope!).id,
        );
        if (target?.kind === "sign-in") {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.signInRequests(server),
          });
        }
      },
    );
    return () => {
      listener.remove();
      received.remove();
    };
  }, [scope, server, queryClient, chat.openChat]);
}
