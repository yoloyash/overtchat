import "server-only";

// Process-local map of streamId -> AbortController for the in-flight streamText
// call. The AbortController is a live JS object, so this can't move to Redis;
// cancel only works in the process that originated the stream. Correct under
// single-replica deploy. Multi-replica would need Redis pub/sub to fan the
// abort out to whichever process holds the controller.
const controllers = new Map<string, AbortController>();

export function register(streamId: string, controller: AbortController): void {
  controllers.set(streamId, controller);
}

export function unregister(streamId: string): void {
  controllers.delete(streamId);
}

export function cancel(streamId: string): boolean {
  const controller = controllers.get(streamId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function has(streamId: string): boolean {
  return controllers.has(streamId);
}
