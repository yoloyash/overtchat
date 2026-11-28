import { ipcMain, powerMonitor, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type { DesktopBadge, DesktopSignInResult } from "@overtchat/shared/desktop";
import {
  IPC,
  type BootState,
  type ColorScheme,
  type ConnectResult,
} from "../shared/ipc";
import { displayHost, pingServer, serverOrigin } from "./server";
import { followInterfaceLanguage } from "./language";
import { discoverLocalServers } from "./local-discovery";
import { installMenu } from "./menu";
import {
  clearServer,
  getLastAddress,
  getServerOrigin,
  setColorScheme,
  setServer,
} from "./settings";
import { exchangeSignInCode } from "./auth";
import { applyBadge } from "./badge";
import { signInWithBrowser } from "./browser-sign-in";
import { applyColorScheme, getMainWindow, getShellWindowState, isAppSender, restartUi, revealWindow } from "./window";
import { checkDesktopUpdates, desktopUpdates, downloadDesktopUpdate, installDesktopUpdate, setUpdateOrigin } from "./updates";

function fromApp(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  return isAppSender(event.sender, event.senderFrame?.url);
}

/** Registers a handler that only the bundled UI in the main window may call. */
function handle<Args extends unknown[], Result>(
  channel: string,
  listener: (...args: Args) => Promise<Result> | Result,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error(`Rejected ${channel} from an untrusted sender`);
    return listener(...(args as Args));
  });
}

async function boot(): Promise<BootState> {
  const origin = getServerOrigin();
  const lastAddress = getLastAddress();
  if (!origin) return { server: null, lastAddress };
  const result = await pingServer(origin);
  // Change Server can run from the native menu while this probe is pending.
  if (getServerOrigin() !== origin) return { server: null, lastAddress: getLastAddress() };
  if (result.ok && result.origin !== origin) {
    // Existing HTTP selections can also acquire an HTTPS redirect later.
    // setServer drops the old origin's session before the UI makes requests.
    setServer(result.origin, result.origin);
  }
  return {
    server: {
      origin: result.ok ? result.origin : origin,
      problem: result.ok ? result.problem : { kind: "unreachable", message: result.message, reason: result.reason },
    },
    lastAddress: getLastAddress(),
  };
}

async function connect(address: string): Promise<ConnectResult> {
  const origin = typeof address === "string" ? serverOrigin(address) : null;
  if (!origin) {
    return {
      ok: false,
      message: "Enter a server address, like chat.example.com.",
      reason: { code: "address-required", host: "" },
    };
  }
  setUpdateOrigin(null);
  const result = await pingServer(origin);
  if (!result.ok) return result;
  const version = result.version ? `OvertChat ${result.version}` : "an older OvertChat";
  if (result.problem?.kind === "server-outdated") {
    setUpdateOrigin(result.origin);
    return {
      ok: false,
      message: `${displayHost(origin)} runs ${version}. Update the server to use the desktop app.`,
      reason: { code: "server-outdated", host: displayHost(origin), version: result.version },
    };
  }
  if (result.problem?.kind === "app-outdated") {
    setUpdateOrigin(result.origin);
    return {
      ok: false,
      message: `${displayHost(origin)} runs ${version}, which is newer than this app. Update the desktop app.`,
      reason: { code: "app-outdated", host: displayHost(origin), version: result.version },
    };
  }
  setServer(result.origin, result.origin);
  setUpdateOrigin(null);
  return { ok: true };
}

/** Signs in with the server's identity provider in the default browser. */
async function signInWithProvider(): Promise<DesktopSignInResult> {
  const serverOrigin = getServerOrigin();
  if (!serverOrigin) return { ok: false, error: "sign_in_failed" };
  const result = await signInWithBrowser({
    serverOrigin,
    openBrowser: (url) => shell.openExternal(url),
    exchange: (grant) => exchangeSignInCode(serverOrigin, grant),
  });
  // The browser has the screen; bring the app back once it's done its part.
  if (result.ok || result.error !== "access_denied") revealWindow();
  return result;
}

export function registerIpc(): void {
  handle(IPC.updateState, desktopUpdates.getState);
  handle(IPC.checkForUpdates, checkDesktopUpdates);
  handle(IPC.downloadUpdate, downloadDesktopUpdate);
  handle(IPC.installUpdate, installDesktopUpdate);
  handle(IPC.boot, boot);
  handle(IPC.connect, connect);
  // React's development StrictMode can mount the connect screen twice.
  let discovery: ReturnType<typeof discoverLocalServers> | null = null;
  handle(IPC.discoverLocalServers, () => {
    if (getServerOrigin()) return [];
    discovery ??= discoverLocalServers(pingServer).finally(() => { discovery = null; });
    return discovery;
  });
  handle(IPC.changeServer, () => {
    clearServer();
    setUpdateOrigin(null);
    restartUi();
  });
  handle(IPC.windowState, getShellWindowState);
  handle(IPC.minimize, () => getMainWindow()?.minimize());
  handle(IPC.toggleMaximize, () => {
    const win = getMainWindow();
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  handle(IPC.close, () => getMainWindow()?.close());
  handle(IPC.setBadge, (badge: DesktopBadge) => {
    if (!badge || typeof badge !== "object") return;
    applyBadge(badge);
  });
  handle(IPC.revealWindow, revealWindow);
  handle(IPC.systemIdle, () => powerMonitor.getSystemIdleTime());
  handle(IPC.signInWithProvider, signInWithProvider);
  ipcMain.on(IPC.theme, (event, scheme: ColorScheme) => {
    if (!fromApp(event) || (scheme !== "light" && scheme !== "dark")) return;
    setColorScheme(scheme);
    applyColorScheme();
  });
  ipcMain.on(IPC.language, (event, language: unknown) => {
    if (fromApp(event) && followInterfaceLanguage(language)) installMenu();
  });
}
