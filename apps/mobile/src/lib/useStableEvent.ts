import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * A callback that keeps one identity for the life of the component and always
 * runs the handler from the latest render. Use it for a handler passed to a
 * memoized child, so the child is not drawn again each time the handler's
 * inputs change. Call the result from events and effects, not while rendering.
 */
export function useStableEvent<Args extends unknown[], Result>(
  handler: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(handler);
  useInsertionEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
