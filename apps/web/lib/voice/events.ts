import "server-only";
import type { UIMessage } from "ai";

export type VoiceChatEvent =
  | { type: "message"; message: UIMessage }
  | { type: "settled" }
  | { type: "error"; message: string };

// Delivery only, like the cancellation registry. SQLite owns all history.
// A session has one subscriber; a slow reader is closed rather than buffered.
const listeners = new Map<string, (event: VoiceChatEvent) => void>();
export function publishVoiceEvent(id: string, event: VoiceChatEvent): void {
  listeners.get(id)?.(event);
}
export function subscribeVoiceEvents(id: string, callback: (event: VoiceChatEvent) => void): () => void {
  if (listeners.has(id)) throw new Error("Voice events already connected");
  listeners.set(id, callback);
  return () => { if (listeners.get(id) === callback) listeners.delete(id); };
}
