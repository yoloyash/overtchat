import type { DesktopBridge, DesktopWindowState } from "@overtchat/shared/desktop";

/** IPC channel names shared by main and preload. */
export const IPC = {
  boot: "desktop:boot",
  connect: "desktop:connect",
  discoverLocalServers: "desktop:discover-local-servers",
  changeServer: "desktop:change-server",
  windowState: "desktop:window-state",
  windowStateChanged: "desktop:window-state-changed",
  minimize: "desktop:minimize",
  toggleMaximize: "desktop:toggle-maximize",
  close: "desktop:close",
  theme: "desktop:theme",
  language: "desktop:language",
  command: "desktop:command",
  updateState: "desktop:update-state",
  updateStateChanged: "desktop:update-state-changed",
  checkForUpdates: "desktop:check-for-updates",
  downloadUpdate: "desktop:download-update",
  installUpdate: "desktop:install-update",
  setBadge: "desktop:set-badge",
  revealWindow: "desktop:reveal-window",
  systemIdle: "desktop:system-idle",
  signInWithProvider: "desktop:sign-in-with-provider",
} as const;

export type ColorScheme = "light" | "dark";

/**
 * Why a server could not be used, as a code the interface can put in the
 * person's language. The English `message` beside it stays for logs.
 */
export interface ConnectFailureReason {
  code:
    | "address-required"
    | "untrusted-certificate"
    | "timeout"
    | "no-answer"
    | "not-overtchat"
    | "redirected"
    | "server-outdated"
    | "app-outdated";
  host: string;
  version?: string | null;
}

/** Why the saved server can't be used right now. */
export type ServerProblem =
  | { kind: "unreachable"; message: string; reason?: ConnectFailureReason }
  /** The server's API level is older than this app's. */
  | { kind: "server-outdated"; version: string | null }
  /** The server's API level is newer than this app's. */
  | { kind: "app-outdated"; version: string | null };

export interface BootState {
  /** The saved server, or null before the first connection. */
  server: { origin: string; problem: ServerProblem | null } | null;
  /** The last selected address, to prefill the connect form. */
  lastAddress: string;
}

export interface LocalServer {
  origin: string;
  version: string | null;
  problem: ServerProblem | null;
}

export type ConnectResult =
  | { ok: true }
  | { ok: false; message: string; reason?: ConnectFailureReason };

export type ShellWindowState = DesktopWindowState;

/** `window.overtchatDesktop` in the desktop app: the UI bridge plus the launcher API. */
export interface DesktopShellBridge extends DesktopBridge {
  platform: string;
  /** Checks the saved server and reports what the window should show. */
  boot(): Promise<BootState>;
  /** Finds local servers without selecting one or changing the session. */
  discoverLocalServers(): Promise<LocalServer[]>;
  /** Saves a reachable, compatible server as the active one. The UI reloads after. */
  connect(address: string): Promise<ConnectResult>;
}
