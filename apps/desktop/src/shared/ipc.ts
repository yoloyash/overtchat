import type { DesktopBridge } from "@overtchat/shared/desktop";

/** IPC channel names shared by main and preload. */
export const IPC = {
  boot: "desktop:boot",
  connect: "desktop:connect",
  changeServer: "desktop:change-server",
  windowState: "desktop:window-state",
  fullscreen: "desktop:fullscreen",
  theme: "desktop:theme",
  command: "desktop:command",
  updateState: "desktop:update-state",
  updateStateChanged: "desktop:update-state-changed",
  checkForUpdates: "desktop:check-for-updates",
  downloadUpdate: "desktop:download-update",
  installUpdate: "desktop:install-update",
} as const;

export type ColorScheme = "light" | "dark";

/** Why the saved server can't be used right now. */
export type ServerProblem =
  | { kind: "unreachable"; message: string }
  /** The server's API level is older than this app's. */
  | { kind: "server-outdated"; version: string | null }
  /** The server's API level is newer than this app's. */
  | { kind: "app-outdated"; version: string | null };

export interface BootState {
  /** The saved server, or null before the first connection. */
  server: { origin: string; problem: ServerProblem | null } | null;
  /** The last address entered, to prefill the connect form. */
  lastAddress: string;
}

export type ConnectResult = { ok: true } | { ok: false; message: string };

export interface ShellWindowState {
  fullscreen: boolean;
}

/** `window.overtchatDesktop` in the desktop app: the UI bridge plus the launcher API. */
export interface DesktopShellBridge extends DesktopBridge {
  platform: string;
  /** Checks the saved server and reports what the window should show. */
  boot(): Promise<BootState>;
  /** Saves a reachable, compatible server as the active one. The UI reloads after. */
  connect(address: string): Promise<ConnectResult>;
}
