import "server-only";

// Process-local map of streamId -> AbortController for in-flight chat
// generation. The AbortController is a live JS object, so this can't move to Redis;
// cancel only works in the process that originated the stream. Correct under
// single-replica deploy. Multi-replica would need Redis pub/sub to fan the
// abort out to whichever process holds the controller.
//
// The map hangs off globalThis because the server's startup code is built
// apart from its routes: a generation the scheduler starts must be one the
// Stop and resume routes can find.
const globalForCancel = globalThis as typeof globalThis & {
  overtchatStreamControllers?: Map<string, AbortController>;
};
const controllers = (globalForCancel.overtchatStreamControllers ??= new Map<
  string,
  AbortController
>());

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
