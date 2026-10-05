import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChatMessageQueue,
  getChatQueueStore,
  type ChatGenerationCoordinator,
  type QueuedChatMessage,
} from "@overtchat/shared";
import { getApiOrigin } from "@/lib/api-url";

export function useChatQueue({
  chatId,
  userId,
  temporary = false,
  status,
  sendMessage,
  generation,
}: {
  chatId: string;
  userId?: string;
  temporary?: boolean;
  status: string;
  sendMessage: (
    message: { text: string; files: QueuedChatMessage["files"] },
    options: { body: Record<string, unknown> },
  ) => Promise<void>;
  generation: ChatGenerationCoordinator;
}) {
  const queryClient = useQueryClient();
  const store = getChatQueueStore(queryClient);
  const scope = `${getApiOrigin()}:${userId ?? ""}`;
  const queue = useMemo(
    () => (temporary ? new ChatMessageQueue() : store.get(scope, chatId)),
    [store, scope, chatId, temporary],
  );
  const snapshot = useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    queue.getSnapshot,
  );
  const latest = useRef(sendMessage);
  useLayoutEffect(() => {
    latest.current = sendMessage;
  });
  useEffect(() => {
    const release = temporary
      ? () => queue.clear()
      : store.retain(scope, chatId, queue);
    const detach = queue.attach({
      prepare: generation.prepare,
      cancel: generation.cancel,
      send: (message) =>
        latest.current(
          { text: message.text, files: message.files },
          { body: message.body },
        ),
    });
    return () => {
      detach();
      release();
    };
  }, [generation, queue, store, scope, chatId, temporary]);
  useEffect(() => {
    if (status === "error") queue.pause();
    queue.setBusy(status === "submitted" || status === "streaming");
  }, [queue, status]);
  return { queue, ...snapshot };
}
