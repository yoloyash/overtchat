import { isCancel, note, select } from "@clack/prompts";
import { installationSpinner as spinner } from "./install-progress.js";
import { startServe } from "./tailscale.js";
import type { InstallationConfig } from "./types.js";

export async function verifyConnection(
  publicUrl: string,
  instanceId: string | undefined,
): Promise<string | null> {
  if (!instanceId)
    return "The installation has no identifier. Run overtchat setup again.";
  const url = new URL("/api/ping", publicUrl);
  url.searchParams.set("check", String(Date.now()));
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok)
      return `The address returned HTTP ${response.status}. Check the tunnel/proxy route and any access gateway in front of it.`;
    const data = (await response.json()) as {
      name?: string;
      ok?: boolean;
      instanceId?: string;
    };
    if (
      data.name !== "overtchat" ||
      data.ok !== true ||
      data.instanceId !== instanceId
    )
      return "The address did not identify this OvertChat installation. Check that the tunnel/proxy points to this server. Older app versions need an update to support this check.";
    return null;
  } catch {
    return "Could not verify the address. Check DNS, HTTPS, network connectivity, and the tunnel/proxy service address.";
  }
}

// The first certificate is issued through the relay once the tunnel is up,
// which can take a minute or two after the containers start.
async function waitForCloudAddress(
  config: InstallationConfig,
  timeoutMs = 180_000,
  intervalMs = 10_000,
): Promise<boolean> {
  const progress = spinner();
  progress.start(`Waiting for ${config.publicUrl} and its HTTPS certificate`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await verifyConnection(config.publicUrl, config.instanceId))) {
      progress.stop(`${config.publicUrl} is ready`);
      return true;
    }
    if (Date.now() + intervalMs > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  progress.stop("The address is not reachable yet", 1);
  return false;
}

export async function finishAccess(
  config: InstallationConfig,
  interactive: boolean,
): Promise<void> {
  if (!config.access || !["advanced", "tailscale", "cloud"].includes(config.access.mode))
    return;
  config.access.connectionStatus = "pending";
  if (config.access.mode === "cloud" && (await waitForCloudAddress(config))) {
    config.access.connectionStatus = "verified";
    note(`Verified ${config.publicUrl} reaches this OvertChat installation.`, "Connection ready");
    return;
  }
  if (config.access.mode === "advanced" && interactive) {
    const choice = await select({
      message: "Check your public address?",
      options: [
        { value: "check", label: "Check connection" },
        { value: "later", label: "Finish with connection pending" },
      ],
    });
    if (isCancel(choice) || choice === "later") return;
  }
  for (;;) {
    let problem: string | null = null;
    if (config.access.mode === "tailscale" && config.access.tailscaleRoute) {
      try {
        await startServe(
          config.access.tailscaleRoute,
          config.managedTailscaleRoute,
        );
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
    }
    problem ??= await verifyConnection(config.publicUrl, config.instanceId);
    if (!problem) {
      config.access.connectionStatus = "verified";
      note(
        `Verified ${config.publicUrl} reaches this OvertChat installation.`,
        "Connection ready",
      );
      return;
    }
    note(
      config.access.mode === "tailscale"
        ? `${problem}\nTailscale may need a minute to issue the first HTTPS certificate. Wait briefly, then retry.`
        : config.access.mode === "cloud"
          ? `${problem}\nCheck that this computer is online, then retry. overtchat logs cloud shows the tunnel; overtchat logs cloud-proxy shows the certificate.`
          : problem,
      "Connection pending",
    );
    if (!interactive) return;
    const choice = await select({
      message: "Check the connection again?",
      options: [
        { value: "retry", label: "Retry" },
        { value: "later", label: "Finish with connection pending" },
      ],
    });
    if (isCancel(choice) || choice === "later") return;
  }
}
