import { net } from "electron";
import { probeServer, type PingOptions, type PingResult } from "./server-probe";

export { displayHost, serverOrigin, type PingResult } from "./server-probe";

/** Electron owns transport so probes use the same network stack as the UI. */
export function pingServer(origin: string, options?: PingOptions): Promise<PingResult> {
  return probeServer(origin, net.fetch, options);
}
