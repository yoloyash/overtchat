import { isIP } from "node:net";
import type { AccessMode, InstallationConfig } from "./types.js";

export function accessMode(config: InstallationConfig): AccessMode {
  if (config.access) return config.access.mode;
  const url = new URL(config.publicUrl);
  if (url.protocol === "https:") return "advanced";
  if (["127.0.0.1", "::1"].includes(config.bindAddress)) return "local";
  return "lan";
}

export function addressValidation(
  value: string | undefined,
  httpsOnly = false,
): string | undefined {
  try {
    const url = new URL(value?.trim() ?? "");
    if (
      httpsOnly
        ? url.protocol !== "https:"
        : !["http:", "https:"].includes(url.protocol)
    ) {
      return httpsOnly
        ? "Use an https:// address."
        : "Use an http:// or https:// address.";
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return "Enter only the address, without a path, credentials, query, or fragment.";
    }
    if (["0.0.0.0", "[::]"].includes(url.hostname))
      return "Enter a reachable hostname or IP address.";
    if (url.hostname.includes("*"))
      return "Enter a specific hostname, without wildcards.";
  } catch {
    return "Enter a valid address, such as https://chat.example.com.";
  }
}

export function portValidation(value: string | undefined): string | undefined {
  if (
    !/^\d+$/u.test(value ?? "") ||
    Number(value) < 1 ||
    Number(value) > 65535
  ) {
    return "Enter a port between 1 and 65535.";
  }
}

export function lanHostValidation(
  value: string | undefined,
): string | undefined {
  if (
    !value ||
    isIP(value) !== 4 ||
    value.startsWith("127.") ||
    value === "0.0.0.0"
  ) {
    return "Enter this server's LAN IPv4 address.";
  }
}

export function additionalAddressValidation(
  value: string | undefined,
  publicUrl: string,
): string | undefined {
  for (const address of (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)) {
    const error = addressValidation(address, publicUrl.startsWith("https:"));
    if (error) return error;
  }
}

export function connectionInstructions(config: InstallationConfig): string {
  const access = config.access;
  if (access?.mode === "tailscale") {
    return "Connect your phone or computer to Tailscale, then open the address below and sign in to OvertChat.";
  }
  if (access?.mode !== "advanced") return "";
  const location = access.proxyLocation ?? "host";
  const target =
    location === "host"
      ? `http://127.0.0.1:${config.appPort}`
      : location === "docker"
        ? "http://app:4717"
        : `http://<this server's LAN IP>:${config.appPort}`;
  const lines =
    access.proxy === "cloudflare"
      ? [
          "In your Cloudflare Tunnel, add a published application:",
          `Hostname: ${new URL(config.publicUrl).hostname}`,
          `Service: ${target}`,
          "Cloudflare setup: https://developers.cloudflare.com/tunnel/setup/",
        ]
      : [
          `Forward ${config.publicUrl} to ${target}.`,
          "Configure HTTPS and support WebSocket upgrades in your reverse proxy.",
        ];
  if (location === "docker") {
    lines.push(
      `Connect your proxy container to the OvertChat Docker network (${config.composeProject}_default).`,
      "For an existing container: docker network connect " +
        `${config.composeProject}_default <proxy-container>`,
      "Also declare that external network in your proxy's Compose configuration so it survives recreation.",
      "Inside the proxy container, localhost refers to the proxy itself.",
    );
  }
  if (location === "remote")
    lines.push(
      "Use the OvertChat server's LAN IP in place of the placeholder. Its published port accepts network connections; allow the proxy through your firewall.",
    );
  return lines.join("\n");
}

export function accessSummary(config: InstallationConfig): string {
  const mode = accessMode(config);
  if (mode === "local") return `This computer: ${config.publicUrl}`;
  if (mode === "lan")
    return `This computer: http://localhost:${config.appPort}\nOther devices on your network: ${config.publicUrl}`;
  return `${config.access?.connectionStatus === "verified" ? "Open" : "Connection pending"}: ${config.publicUrl}`;
}
