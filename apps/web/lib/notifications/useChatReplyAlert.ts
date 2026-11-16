"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { playAgentAlertSound } from "./sound";
import {
  closeSystemNotification,
  showSystemNotification,
} from "./systemNotification";
import { useAgentAlertChoices } from "./useAgentAlertChoices";

/** A glance's worth of the reply, like an agent alert's body. */
const BODY_LIMIT = 160;

const notificationKey = (chatId: string) => `chat:${chatId}`;

/** The reply's visible text: never reasoning, tool input or tool output. */
export function chatReplyPreview(
  parts: readonly { type: string; text?: unknown }[],
): string {
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > BODY_LIMIT
    ? `${text.slice(0, BODY_LIMIT - 1).trimEnd()}…`
    : text;
}

/**
 * Says when a chat's reply finished with the window in the background: the
 * chime and a system notification, as the device chose. The reply itself is
 * on the page, so a window in front says nothing. `missed` turns true the
 * first time a reply finishes unseen, which is when alerts are worth offering.
 */
export function useChatReplyAlert(chatId: string) {
  const navigate = useNavigate();
  const { sound, system } = useAgentAlertChoices();
  const [missed, setMissed] = useState(false);

  // The chat hook keeps its first callbacks; read the latest choices here.
  const current = useRef({ chatId, sound, system });
  useEffect(() => {
    current.current = { chatId, sound, system };
  }, [chatId, sound, system]);

  // Coming back to the window is seeing the reply.
  useEffect(() => {
    const seen = () => closeSystemNotification(notificationKey(chatId));
    window.addEventListener("focus", seen);
    return () => {
      window.removeEventListener("focus", seen);
      seen();
    };
  }, [chatId]);

  const replyFinished = useCallback(
    (parts: readonly { type: string; text?: unknown }[]) => {
      if (document.visibilityState === "visible" && document.hasFocus()) return;
      setMissed(true);
      const { chatId, sound, system } = current.current;
      if (!sound && !system) return;
      const chimed = sound ? playAgentAlertSound("done") : Promise.resolve(false);
      if (!system) return;
      // The system's own sound stands in for a chime that could not play.
      void chimed.then((played) =>
        showSystemNotification({
          key: notificationKey(chatId),
          title: "Your response is ready",
          body: chatReplyPreview(parts) || undefined,
          silent: !sound || played,
          onOpen: () => void navigate({ to: "/chat/$id", params: { id: chatId } }),
        }),
      );
    },
    [navigate],
  );

  return { replyFinished, missed };
}
