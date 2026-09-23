import { commandExists, runCommand, type RunOptions } from "./process.js";
import type { AccessConfig } from "./types.js";

async function tailscaleCommand(): Promise<string | null> {
  if (await commandExists("tailscale")) return "tailscale";
  const bundled = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  if (process.platform === "darwin" && await commandExists(bundled)) return bundled;
  return null;
}

async function runTailscale(args: string[], options: RunOptions = {}) {
  const command = await tailscaleCommand();
  if (!command) throw new Error("Tailscale not found. Install and connect Tailscale first.");
  return runCommand(command, args, options);
}

type Route = NonNullable<AccessConfig["tailscaleRoute"]>;
type ServeConfig = {
  TCP?: Record<string, { HTTPS?: boolean }>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  AllowFunnel?: Record<string, boolean>;
  Foreground?: Record<string, ServeConfig>;
};

export function sameServeRoute(left?: Route, right?: Route): boolean {
  return (
    left?.hostname === right?.hostname &&
    left?.port === right?.port &&
    left?.target === right?.target
  );
}

export async function detectTailscale(): Promise<{
  hostname?: string;
  problem?: string;
}> {
  if (!(await tailscaleCommand()))
    return {
      problem:
        "Tailscale not found. Install Tailscale, then run overtchat setup again.",
    };
  const result = await runTailscale(["status", "--json"], {
    timeoutMs: 10_000,
  });
  let status: {
    BackendState?: string;
    Self?: { DNSName?: string; Online?: boolean };
  };
  try {
    status = JSON.parse(result.stdout);
  } catch {
    return {
      problem:
        "Could not read Tailscale status. Check that its service is running and your user can access it.",
    };
  }
  const problems: Record<string, string> = {
    NeedsLogin:
      process.platform === "darwin"
        ? "Tailscale needs sign-in. Open Tailscale, sign in, then retry."
        : "Tailscale needs sign-in. Run sudo tailscale up, complete sign-in, then retry.",
    NeedsMachineAuth:
      "This device is waiting for approval in the Tailscale admin console. Approve it, then retry.",
    Stopped: process.platform === "darwin"
      ? "Tailscale is disconnected. Connect in the Tailscale app, then retry."
      : "Tailscale is disconnected. Run sudo tailscale up, then retry.",
  };
  if (status.BackendState !== "Running")
    return {
      problem:
        problems[status.BackendState ?? ""] ??
        "Tailscale is not ready. Check tailscale status, then retry.",
    };
  if (result.exitCode !== 0 || status.Self?.Online === false)
    return {
      problem: "Tailscale is offline. Restore its connection, then retry.",
    };
  const hostname = status.Self?.DNSName?.replace(/\.$/u, "");
  if (
    !hostname ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.ts\.net$/iu.test(hostname)
  ) {
    return {
      problem:
        "Tailscale has no usable device DNS name. Enable MagicDNS in the Tailscale admin console, then retry.",
    };
  }
  return { hostname };
}

async function serveConfig(): Promise<ServeConfig> {
  const result = await runTailscale(["serve", "status", "--json"], {
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0)
    throw new Error(
      "Could not inspect Tailscale Serve. Check Tailscale permissions and use a version supporting tailscale serve status --json.",
    );
  const parsed: unknown = JSON.parse(result.stdout);
  if (parsed === null) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Unrecognized Tailscale Serve configuration.");
  return parsed as ServeConfig;
}

export function serveConflict(
  config: ServeConfig,
  route: Route,
  previous?: Route,
): string | undefined {
  const key = `${route.hostname}:${route.port}`;
  if (config.AllowFunnel?.[key])
    return "This Tailscale address has public Funnel access enabled. Disable Funnel for this address before using private OvertChat access.";
  for (const foreground of Object.values(config.Foreground ?? {})) {
    if (foreground.TCP?.[route.port] || foreground.Web?.[key])
      return "This Tailscale port is used by a foreground Serve session. Stop that session or choose another HTTPS port.";
  }
  const handlers = config.Web?.[key]?.Handlers ?? {};
  const root = handlers["/"];
  const owned =
    previous?.hostname === route.hostname &&
    previous.port === route.port &&
    root?.Proxy === previous.target;
  if (root && !owned)
    return "This Tailscale address already serves another application. Choose another HTTPS port.";
  // Even an empty HTTP/TCP listener may belong to another application.
  if (config.TCP?.[route.port] && (!config.TCP[route.port].HTTPS || !owned))
    return "This Tailscale port is already in use. Choose another HTTPS port.";
  if (Object.keys(handlers).some((path) => path !== "/"))
    return "This Tailscale address has other application routes. Choose another HTTPS port.";
}

export async function checkServeRoute(
  route: Route,
  previous?: Route,
): Promise<void> {
  const problem = serveConflict(await serveConfig(), route, previous);
  if (problem) throw new Error(problem);
}

export async function startServe(
  route: Route,
  previous?: Route,
): Promise<void> {
  await checkServeRoute(route, previous);
  const result = await runTailscale(
    [
      "serve",
      "--bg",
      "--yes",
      `--https=${route.port}`,
      "--set-path=/",
      route.target,
    ],
    { timeoutMs: 20_000 },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      [
        "Tailscale Serve could not start. Complete any HTTPS enablement below, or grant your user Tailscale operator permission, then retry.",
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const state = await serveConfig();
  const key = `${route.hostname}:${route.port}`;
  if (
    state.Web?.[key]?.Handlers?.["/"]?.Proxy !== route.target ||
    !state.TCP?.[route.port]?.HTTPS ||
    state.AllowFunnel?.[key]
  ) {
    throw new Error(
      "Tailscale did not confirm the private HTTPS route. Check tailscale serve status, then retry.",
    );
  }
}

export async function removeServe(route: Route): Promise<void> {
  const config = await serveConfig();
  const key = `${route.hostname}:${route.port}`;
  const root = config.Web?.[key]?.Handlers?.["/"];
  if (!root) return;
  if (root.Proxy !== route.target)
    throw new Error(
      "The previous OvertChat Tailscale route was changed outside setup. Remove or move that route with tailscale serve before changing access mode.",
    );
  const result = await runTailscale(
    ["serve", "--bg", `--https=${route.port}`, "--set-path=/", "off"],
    { timeoutMs: 10_000 },
  );
  if (result.exitCode !== 0)
    throw new Error(
      "Could not remove the previous OvertChat Tailscale route. Check your Tailscale permissions, then retry setup.",
    );
  if ((await serveConfig()).Web?.[key]?.Handlers?.["/"])
    throw new Error(
      "The previous Tailscale route is still active. Remove it before changing access mode.",
    );
}
