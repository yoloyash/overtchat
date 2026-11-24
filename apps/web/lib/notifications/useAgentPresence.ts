"use client";

import { useEffect } from "react";
import { apiUrl } from "@/lib/api-url";
import { desktopBridge } from "@/lib/desktop";
import {
  AGENT_PRESENCE_HEARTBEAT_MS,
  AGENT_PRESENCE_WINDOW_MS,
} from "./agentNotification";
import { agentClientId, subscribeAgentStream } from "./agentStream";

/** What counts as using the page. Moving the pointer over it does not. */
const USE_EVENTS = ["focus", "pointerdown", "keydown", "wheel", "touchstart"] as const;

/** When this client was last used; loading the page is using it. */
let usedAt = Date.now();
/** Servers that predate idle times refuse a heartbeat that carries one. */
let plainHeartbeat = false;

/**
 * Reports this client to the server: every half minute while the page can be
 * seen, at once when that or the open session changes, and in the desktop
 * app also with the window in the background. Each report says how long ago
 * the client was used, which in the desktop app means the computer.
 */
export function useAgentPresence(viewing: string | null, notify: boolean): void {
  useEffect(() => {
    const post = (idleMs?: number) =>
      fetch(apiUrl("/api/agent-presence"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: agentClientId(),
          visible: document.visibilityState === "visible",
          viewing,
          notify,
          ...(idleMs === undefined ? {} : { idleMs }),
        }),
        keepalive: true,
      });
    const send = () => {
      if (plainHeartbeat) {
        void post().catch(() => undefined);
        return;
      }
      void post(Math.max(0, Date.now() - usedAt))
        .then((response) => {
          if (response.status !== 400) return;
          plainHeartbeat = true;
          return post();
        })
        .catch(() => undefined);
    };
    const tick = async () => {
      const idle = await desktopBridge()
        ?.getSystemIdleSeconds?.()
        .catch(() => undefined);
      if (idle !== undefined) usedAt = Math.max(usedAt, Date.now() - idle * 1000);
      if (document.visibilityState === "visible") {
        send();
        return;
      }
      // A browser page in the background has nothing new to say. The desktop
      // app does, but a server that takes no idle time would read any report
      // as use, so it only hears from a computer that is in use.
      if (idle === undefined) return;
      if (!plainHeartbeat || idle * 1000 < AGENT_PRESENCE_WINDOW_MS) send();
    };
    const used = () => {
      const quiet = Date.now() - usedAt;
      usedAt = Date.now();
      // Back after a while: say so now, not at the next heartbeat.
      if (quiet > AGENT_PRESENCE_HEARTBEAT_MS) send();
    };
    send();
    const timer = setInterval(() => void tick(), AGENT_PRESENCE_HEARTBEAT_MS);
    document.addEventListener("visibilitychange", send);
    window.addEventListener("pagehide", send);
    for (const name of USE_EVENTS) {
      window.addEventListener(name, used, { passive: true });
    }
    // A reconnected stream is a new attachment the server should know about.
    const unsubscribe = subscribeAgentStream((event) => {
      if (event.type === "open") send();
    });
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", send);
      window.removeEventListener("pagehide", send);
      for (const name of USE_EVENTS) window.removeEventListener(name, used);
      unsubscribe();
    };
  }, [viewing, notify]);
}
