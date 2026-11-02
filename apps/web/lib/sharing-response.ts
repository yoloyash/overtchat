import { ShareBadRequest, ShareConflict } from "@/lib/db/chatShares";

import { shareHeaders } from "./share-headers";
export { shareHeaders } from "./share-headers";

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
    if (error instanceof ShareConflict || error instanceof ShareBadRequest) {
      return new Response(error.message, {
        status: error instanceof ShareBadRequest ? 400 : 409,
        headers: shareHeaders,
      });
    }
    throw error;
  }
}
