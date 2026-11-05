import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * When each message in the open chat was sent, in epoch milliseconds, keyed by
 * message ID. `null` marks a saved message whose time the server did not
 * report, which keeps it from being mistaken for one that just arrived.
 */
export type MessageTimes = Record<string, number | null>;

type LoadedMessages = {
  messages: readonly { id: string }[];
  messageTimes?: Record<string, number>;
};

/** The times of messages loaded from the server. */
export function loadedMessageTimes({
  messages,
  messageTimes,
}: LoadedMessages): MessageTimes {
  return Object.fromEntries(
    messages.map(({ id }) => [id, messageTimes?.[id] ?? null]),
  );
}

/**
 * Gives every message without an entry the current time: it was sent or
 * received in this window just now. Returns the same object when nothing is
 * new, so a caller can use it as a state update without causing a render.
 */
export function stampNewMessages(
  times: MessageTimes,
  messages: readonly { id: string }[],
  now: number,
): MessageTimes {
  const unseen = messages.filter(({ id }) => times[id] === undefined);
  if (unseen.length === 0) return times;
  return {
    ...times,
    ...Object.fromEntries(unseen.map(({ id }) => [id, now])),
  };
}

/** Holds one open chat's message times outside React state. */
export function createMessageTimeStore(initial: MessageTimes) {
  let times = initial;
  const listeners = new Set<() => void>();
  const set = (next: MessageTimes) => {
    if (next === times) return;
    times = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => times,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    addLoaded: (loaded: LoadedMessages) =>
      set({ ...times, ...loadedMessageTimes(loaded) }),
    stampNew: (messages: readonly { id: string }[], now: number) =>
      set(stampNewMessages(times, messages, now)),
  };
}

/**
 * Tracks when the open chat's messages were sent. Saved history brings the
 * server's times; a message that appears during this visit is stamped with
 * the clock, which is why the times live in a store rather than in state
 * derived from the messages.
 */
export function useMessageTimes(
  messages: readonly { id: string }[],
  initial: LoadedMessages,
) {
  const [store] = useState(() =>
    createMessageTimeStore(loadedMessageTimes(initial)),
  );
  useEffect(() => {
    store.stampNew(messages, Date.now());
  }, [messages, store]);
  const messageTimes = useSyncExternalStore(
    store.subscribe,
    store.get,
    store.get,
  );
  return { messageTimes, addLoadedMessages: store.addLoaded };
}
