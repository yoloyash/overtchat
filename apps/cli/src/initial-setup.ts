import { verifyConnection } from "./connection-check.js";
import { protectInstallationSecrets } from "./install-log.js";
import type { InstallationConfig } from "./types.js";

/** Retrieve only over verified loopback; the public URL is for display only. */
export async function initialSetupLink(
  config: Pick<InstallationConfig, "appPort" | "instanceId" | "publicUrl">,
  managementSecret: string | undefined,
): Promise<string | null> {
  const localUrl = `http://127.0.0.1:${config.appPort}`;
  const problem = await verifyConnection(localUrl, config.instanceId);
  if (problem) throw new Error(`Cannot retrieve setup code: ${problem}`);
  if (!managementSecret || managementSecret.length < 32)
    throw new Error("Cannot retrieve setup code: run overtchat setup to repair the management secret.");
  const response = await fetch(`${localUrl}/api/internal/management/setup`, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${managementSecret}` },
    cache: "no-store",
  });
  // Older installations predate setup codes.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Cannot retrieve setup code (HTTP ${response.status}).`);
  const data = await response.json() as { required?: boolean; code?: string | null };
  if (data.required === false) return null;
  if (data.required !== true || typeof data.code !== "string" ||
      !/^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){2}$/.test(data.code))
    throw new Error("The server returned an invalid setup response.");
  protectInstallationSecrets(data.code);
  const url = new URL("/signup", config.publicUrl);
  url.hash = `setup=${data.code}`;
  return url.toString();
}
