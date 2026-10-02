import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import {
  IPC,
  type BootState,
  type ColorScheme,
  type ConnectResult,
  type ShellWindowState,
} from "../shared/ipc";
import { displayHost, pingServer, serverOrigin } from "./server";
import {
  clearServer,
  getLastAddress,
  getServerOrigin,
  setColorScheme,
  setServer,
} from "./settings";
import { applyColorScheme, getMainWindow, isAppSender, restartUi } from "./window";

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
  return {
    server: {
      origin,
      problem: result.ok ? result.problem : { kind: "unreachable", message: result.message },
    },
    lastAddress,
  };
}

async function connect(address: string): Promise<ConnectResult> {
  const origin = typeof address === "string" ? serverOrigin(address) : null;
  if (!origin) return { ok: false, message: "Enter a server address, like chat.example.com." };
  const result = await pingServer(origin);
  if (!result.ok) return result;
  const version = result.version ? `OvertChat ${result.version}` : "an older OvertChat";
  if (result.problem?.kind === "server-outdated") {
    return {
      ok: false,
      message: `${displayHost(origin)} runs ${version}. Update the server to use the desktop app.`,
    };
  }
  if (result.problem?.kind === "app-outdated") {
    return {
      ok: false,
      message: `${displayHost(origin)} runs ${version}, which is newer than this app. Update the desktop app.`,
    };
  }
  setServer(origin, address.trim());
  return { ok: true };
}

export function registerIpc(): void {
  handle(IPC.boot, boot);
  handle(IPC.connect, connect);
  handle(IPC.changeServer, () => {
    clearServer();
    restartUi();
  });
  handle(IPC.windowState, (): ShellWindowState => ({
    fullscreen: getMainWindow()?.isFullScreen() ?? false,
  }));
  ipcMain.on(IPC.theme, (event, scheme: ColorScheme) => {
    if (!fromApp(event) || (scheme !== "light" && scheme !== "dark")) return;
    setColorScheme(scheme);
    applyColorScheme();
  });
}
