import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  ChatMessageQueue,
  type ChatGenerationCoordinator,
  type QueuedChatMessage,
} from "@overtchat/shared";
import { getApiBase } from "@/lib/api";

const queues = new Map<string, ChatMessageQueue>();

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
  const scope = `${getApiBase()}:${userId ?? ""}:${chatId}`;
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
  const latest = useRef(sendMessage);
  useLayoutEffect(() => {
    latest.current = sendMessage;
  });
  useEffect(
    () =>
      queue.attach({
        prepare: generation.prepare,
        cancel: generation.cancel,
        send: (message) =>
          latest.current(
            { text: message.text, files: message.files },
            { body: message.body },
          ),
      }),
    [generation, queue],
  );
  useEffect(() => {
    if (status === "error") queue.pause();
    queue.setBusy(status === "submitted" || status === "streaming");
  }, [queue, status]);
  return { queue, ...snapshot };
}
