import type { AsyncRouteComponent } from "@tanstack/react-router";

/**
 * Lets a route component that renders lazy pages download them with the
 * route, the way a `lazyRouteComponent` would, so navigation waits for the
 * page code instead of suspending after it commits.
 */
export function withPages<T extends object>(
  component: T,
  ...pages: AsyncRouteComponent<never>[]
): T & { preload: () => Promise<void> } {
  return Object.assign(component, {
    preload: async () => {
      await Promise.all(pages.map((page) => page.preload?.()));
    },
  });
}
