import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  ChatMessageQueue,
  type ChatGenerationState,
  type QueuedChatMessage,
} from "@overtchat/shared";
import type { UIMessage } from "ai";
import { apiUrl, getApiOrigin } from "@/lib/api-url";

const queues = new Map<string, ChatMessageQueue>();

export function useChatQueue({
  chatId,
  userId,
  temporary = false,
  status,
  sendMessage,
  stop,
  setMessages,
}: {
  chatId: string;
  userId?: string;
  temporary?: boolean;
  status: string;
  sendMessage: (
    message: { text: string; files: QueuedChatMessage["files"] },
    options: { body: Record<string, unknown> },
  ) => Promise<void>;
  stop: () => void | Promise<void>;
  setMessages: (updater: (messages: UIMessage[]) => UIMessage[]) => void;
}) {
  const scope = `${getApiOrigin()}:${userId ?? ""}:${chatId}`;
  const queue = useMemo(() => {
    if (temporary) return new ChatMessageQueue();
    let saved = queues.get(scope);
    if (!saved) {
      saved = new ChatMessageQueue();
      queues.set(scope, saved);
    }
    return saved;
  }, [scope, temporary]);
  const snapshot = useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    queue.getSnapshot,
  );
  const latest = useRef({ status, sendMessage, stop, setMessages });
  useLayoutEffect(() => {
    latest.current = { status, sendMessage, stop, setMessages };
  });

  useEffect(() => {
    const delay = (signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) throw new Error("Queue detached");
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 100);
        signal.addEventListener("abort", abort, { once: true });
      });
    async function settle(
      signal: AbortSignal,
      interrupt: boolean,
      explicit = false,
    ) {
      const deadline = Date.now() + 30_000;
      // A submitted request may not have claimed its server generation yet.
      // Wait for admission before cancelling, including the first turn in a chat.
      while (latest.current.status === "submitted") {
        if (Date.now() > deadline)
          throw new Error("Generation admission timed out");
        await delay(signal);
      }
      async function stopReader() {
        await latest.current.stop();
        // stop() requests an abort; its promise does not await onFinish.
        // Let that callback finish before unpausing or admitting a new turn.
        while (
          latest.current.status === "streaming" ||
          latest.current.status === "submitted"
        ) {
          if (Date.now() > deadline)
            throw new Error("The response is still stopping");
          await delay(signal);
        }
      }
      if (temporary) {
        if (interrupt) await stopReader();
        return;
      }
      let cancelledStream: string | null = null;
      while (true) {
        if (signal.aborted) throw new Error("Queue detached");
        const response = await fetch(
          apiUrl(`/api/chat/${encodeURIComponent(chatId)}/stream/status`),
          { signal, cache: "no-store" },
        );
        if (response.status === 404) return; // A new chat has no server row yet.
        if (!response.ok) throw new Error("Could not inspect the response");
        const generation = (await response.json()) as ChatGenerationState;
        if (!generation.active) {
          if (interrupt) await stopReader();
          const message = generation.responseMessage;
          if (message)
            latest.current.setMessages((current) => {
              const index = current.findIndex((item) => item.id === message.id);
              if (index < 0) return [...current, message];
              return current.map((item) =>
                item.id === message.id ? message : item,
              );
            });
          if (
            !interrupt &&
            !explicit &&
            (generation.status === "error" || generation.status === "aborted")
          )
            queue.pause();
          return;
        }
        if (interrupt && generation.streamId !== cancelledStream) {
          const cancelled = await fetch(
            apiUrl(`/api/chat/${encodeURIComponent(chatId)}/stream/cancel`),
            {
              method: "POST",
              signal,
            },
          );
          if (!cancelled.ok) throw new Error("Could not cancel the response");
          cancelledStream = generation.streamId;
        }
        if (interrupt && Date.now() > deadline)
          throw new Error("The response is still stopping");
        await delay(signal);
      }
    }
    return queue.attach({
      prepare: (signal, explicit) => settle(signal, false, explicit),
      cancel: (signal) => settle(signal, true),
      send: (message) =>
        latest.current.sendMessage(
          { text: message.text, files: message.files },
          { body: message.body },
        ),
    });
  }, [chatId, queue, temporary]);

  useEffect(() => {
    if (status === "error") queue.pause();
    queue.setBusy(status === "submitted" || status === "streaming");
  }, [queue, status]);
  return { queue, ...snapshot };
}
