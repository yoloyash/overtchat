import { ShareConflict } from "@/lib/db/chatShares";

export const shareHeaders = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

export function shareResponse(action: () => unknown): Response {
  try {
    const result = action();
    return result === null
      ? new Response("Shared chat not found", {
          status: 404,
          headers: shareHeaders,
        })
      : Response.json(result, { headers: shareHeaders });
  } catch (error) {
    if (error instanceof ShareConflict) {
      return new Response(error.message, {
        status: 409,
        headers: shareHeaders,
      });
    }
    throw error;
  }
}
