import { net } from "electron";
import { probeServer } from "./server-probe";

export { displayHost, serverOrigin, type PingResult } from "./server-probe";

/** Electron owns transport so probes use the same network stack as the UI. */
export function pingServer(origin: string, options?: Parameters<typeof probeServer>[2]) {
  return probeServer(origin, net.fetch, options);
}
