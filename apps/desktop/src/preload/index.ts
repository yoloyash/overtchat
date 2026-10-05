import { contextBridge, ipcRenderer, webFrame } from "electron";
import {
  DESKTOP_COMMANDS,
  DESKTOP_SHELL_ATTRIBUTE,
  DESKTOP_TITLEBAR_INSET_PROPERTY,
  type DesktopCommand,
  type DesktopUpdateState,
} from "@overtchat/shared/desktop";
import { IPC, type DesktopShellBridge, type ShellWindowState } from "../shared/ipc";

/** Where content may start after the traffic lights: their trailing edge (79pt) plus a gap. */
const TRAFFIC_LIGHTS_INSET = 92;

/** Runs once `<html>` exists, which is before the page's first paint. */
function withRoot(callback: () => void): void {
  if (document.documentElement) {
    callback();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!document.documentElement) return;
    observer.disconnect();
    callback();
  });
  observer.observe(document, { childList: true });
}

/** Lets the UI draw under the macOS titlebar: marks `<html>` and tracks the inset. */
function integrateTitlebar(): void {
  let fullscreen = false;
  const update = () => {
    const root = document.documentElement;
    if (!root) return;
    const inset = fullscreen ? 0 : TRAFFIC_LIGHTS_INSET / webFrame.getZoomFactor();
    root.setAttribute(DESKTOP_SHELL_ATTRIBUTE, process.platform);
    root.style.setProperty(DESKTOP_TITLEBAR_INSET_PROPERTY, `${Math.round(inset)}px`);
  };
  withRoot(update);
  // Zooming changes the page's viewport size, so it always fires a resize.
  window.addEventListener("resize", update);
  ipcRenderer.on(IPC.fullscreen, (_event, value: boolean) => {
    fullscreen = value;
    update();
  });
  // Main only answers the page once it has committed to the app's origin.
  window.addEventListener("DOMContentLoaded", () => {
    void ipcRenderer.invoke(IPC.windowState).then((state: ShellWindowState) => {
      fullscreen = state.fullscreen;
      update();
    });
  });
}

/** Reports the UI's resolved theme so the window background matches it. */
function reportColorScheme(): void {
  let last: string | null = null;
  const report = () => {
    const scheme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    if (scheme === last) return;
    last = scheme;
    ipcRenderer.send(IPC.theme, scheme);
  };
  window.addEventListener("DOMContentLoaded", () => {
    report();
    new MutationObserver(report).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  });
}

function exposeBridge(): void {
  const listeners = new Set<(command: DesktopCommand) => void>();
  ipcRenderer.on(IPC.command, (_event, command: DesktopCommand) => {
    if (!DESKTOP_COMMANDS.includes(command)) return;
    for (const listener of listeners) listener(command);
  });
  const bridge: DesktopShellBridge = {
    platform: process.platform,
    onCommand(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    boot: () => ipcRenderer.invoke(IPC.boot),
    discoverLocalServers: () => ipcRenderer.invoke(IPC.discoverLocalServers),
    connect: (address) => ipcRenderer.invoke(IPC.connect, address),
    changeServer: () => ipcRenderer.invoke(IPC.changeServer),
    getUpdateState: () => ipcRenderer.invoke(IPC.updateState),
    checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
    downloadUpdate: () => ipcRenderer.invoke(IPC.downloadUpdate),
    installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
    onUpdateState(listener) {
      const onState = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState) => listener(state);
      ipcRenderer.on(IPC.updateStateChanged, onState);
      return () => { ipcRenderer.removeListener(IPC.updateStateChanged, onState); };
    },
  };
  contextBridge.exposeInMainWorld("overtchatDesktop", bridge);
}

exposeBridge();
reportColorScheme();
if (process.platform === "darwin") integrateTitlebar();
