/**
 * Level of the HTTP API contract that bundled clients build against. Increment
 * it when a server change requires clients built for the previous level to
 * update; additive endpoints and fields do not change it when existing clients
 * accept them. Strict client parsers can make an added field incompatible.
 */
export const CLIENT_API_LEVEL = 5;

export interface PingResponse {
  ok: true;
  name: "overtchat";
  version: string;
  /** {@link CLIENT_API_LEVEL} of the server. Absent before bundled clients. */
  apiLevel?: number;
}
