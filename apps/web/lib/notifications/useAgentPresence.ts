"use client";

import { useEffect } from "react";
import { apiUrl } from "@/lib/api-url";
import { desktopBridge } from "@/lib/desktop";
import {
  AGENT_PRESENCE_HEARTBEAT_MS,
  AGENT_PRESENCE_WINDOW_MS,
} from "./agentNotification";
import { agentClientId, subscribeAgentStream } from "./agentStream";

/**
 * Reports this client to the server: every half minute while the page can be
 * seen, at once when that or the open session changes, and in the desktop
 * app also while the computer is in use with the window in the background.
 */
export function useAgentPresence(viewing: string | null, notify: boolean): void {
  useEffect(() => {
    const send = () => {
      void fetch(apiUrl("/api/agent-presence"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: agentClientId(),
          visible: document.visibilityState === "visible",
          viewing,
          notify,
        }),
        keepalive: true,
      }).catch(() => undefined);
    };
    const tick = async () => {
      if (document.visibilityState === "visible") {
        send();
        return;
      }
      const idle = await desktopBridge()
        ?.getSystemIdleSeconds?.()
        .catch(() => undefined);
      if (idle !== undefined && idle * 1000 < AGENT_PRESENCE_WINDOW_MS) send();
    };
    send();
    const timer = setInterval(() => void tick(), AGENT_PRESENCE_HEARTBEAT_MS);
    document.addEventListener("visibilitychange", send);
    window.addEventListener("pagehide", send);
    // A reconnected stream is a new attachment the server should know about.
    const unsubscribe = subscribeAgentStream((event) => {
      if (event.type === "open") send();
    });
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", send);
      window.removeEventListener("pagehide", send);
      unsubscribe();
    };
  }, [viewing, notify]);
}
