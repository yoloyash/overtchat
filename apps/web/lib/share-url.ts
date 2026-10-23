import "server-only";
import type { ChatShare } from "@overtchat/shared";

/** Managed setup owns BETTER_AUTH_URL, including the public Cloud hostname. */
export function withShareUrl<T extends ChatShare | null>(share: T): T {
  if (!share) return share;
  try {
    const base = new URL(process.env.BETTER_AUTH_URL ?? "");
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(base.hostname) ||
      base.hostname.endsWith(".localhost")
    )
      return share;
    return {
      ...share,
      url: new URL(`/share/${encodeURIComponent(share.id)}`, base.origin).href,
    };
  } catch {
    // Unconfigured/local development: clients use their actual connection address.
    return share;
  }
}
