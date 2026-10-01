/**
 * Level of the HTTP API contract that bundled clients build against. Increment
 * it when a server change requires clients built for the previous level to
 * update; additive endpoints and fields do not change it.
 */
export const CLIENT_API_LEVEL = 1;

export interface PingResponse {
  ok: true;
  name: "overtchat";
  version: string;
  /** {@link CLIENT_API_LEVEL} of the server. Absent before bundled clients. */
  apiLevel?: number;
}
