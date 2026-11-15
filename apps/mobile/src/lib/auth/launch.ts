/**
 * How long a launch waits to learn the session before showing screens anyway,
 * so a server that never answers can't hold the splash screen.
 */
export const LAUNCH_SESSION_WAIT_MS = 3000;

/**
 * Whether the session says which screens to show: signed-in or signed-out.
 * Better Auth's first check reports pending, with no session, until the
 * stored session is restored or the server answers. A stored session arrives
 * while that check is still pending.
 */
export function sessionKnown(session: {
  data: { user?: unknown } | null;
  isPending: boolean;
}): boolean {
  return Boolean(session.data?.user) || !session.isPending;
}
