import { app, autoUpdater, BrowserWindow, nativeTheme, screen, shell, type WebContents } from "electron";
import path from "node:path";
import type { DesktopCommand } from "@overtchat/shared/desktop";
import { IPC } from "../shared/ipc";
import { attachContextMenu } from "./context-menu";
import { APP_ORIGIN, APP_URL, originOf } from "./protocol";
import {
  getColorScheme,
  getServerOrigin,
  getWindowBounds,
  getZoomLevel,
  setWindowBounds,
  setZoomLevel,
} from "./settings";

/** Height of the UI's header row, which the traffic lights center within. */
const TITLEBAR_HEIGHT = 48;
const TRAFFIC_LIGHTS_X = 18;
const TRAFFIC_LIGHTS_HEIGHT = 14;
const ZOOM_LEVELS = [-3, -2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3];

/** The theme's `--background` in each scheme, shown before the UI paints. */
const BACKGROUND = { light: "#fcfdfa", dark: "#0f1009" } as const;

const isMac = process.platform === "darwin";

let mainWindow: BrowserWindow | null = null;
let quitting = false;

app.on("before-quit", () => {
  quitting = true;
});
// Squirrel closes windows before app's before-quit event. Allow those closes
// instead of applying macOS's normal hide-on-close behavior during an update.
autoUpdater.on("before-quit-for-update", () => {
  quitting = true;
});

function hasOrigin(url: string, origin: string | null): boolean {
  return !!origin && originOf(url) === origin;
}

/** Whether an IPC sender is the main window showing the bundled UI. */
export function isAppSender(sender: WebContents, frameUrl: string | undefined): boolean {
  return sender === getMainWindow()?.webContents && !!frameUrl && hasOrigin(frameUrl, APP_ORIGIN);
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function backgroundColor(): string {
  return BACKGROUND[getColorScheme() ?? (nativeTheme.shouldUseDarkColors ? "dark" : "light")];
}

export function applyColorScheme(): void {
  getMainWindow()?.setBackgroundColor(backgroundColor());
}

function openExternal(url: string): void {
  try {
    const { protocol } = new URL(url);
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") {
      void shell.openExternal(url);
    }
  } catch {
    // Ignore malformed URLs from page content.
  }
}

function restoredBounds(): Electron.Rectangle & { maximized: boolean } {
  const saved = getWindowBounds();
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(saved?.width ?? 1240, area.width);
  const height = Math.min(saved?.height ?? 820, area.height);
  if (saved?.x !== undefined && saved.y !== undefined) {
    const candidate = { x: saved.x, y: saved.y, width, height };
    const visible = screen.getDisplayMatching(candidate).workArea;
    const overlaps =
      candidate.x < visible.x + visible.width - 80 &&
      candidate.x + width > visible.x + 80 &&
      candidate.y >= visible.y - 10 &&
      candidate.y < visible.y + visible.height - 80;
    if (overlaps) return { ...candidate, maximized: saved.maximized };
  }
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
    maximized: saved?.maximized ?? false,
  };
}

function saveBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isFullScreen() || win !== mainWindow) return;
  const { x, y, width, height } = win.getNormalBounds();
  setWindowBounds({ x, y, width, height, maximized: win.isMaximized() });
}

/** Keeps the traffic lights vertically centered in the UI's header at any zoom. */
function syncTrafficLights(win: BrowserWindow): void {
  if (!isMac || win.isDestroyed()) return;
  const zoom = win.webContents.getZoomFactor();
  const y = Math.round((TITLEBAR_HEIGHT * zoom - TRAFFIC_LIGHTS_HEIGHT) / 2);
  win.setWindowButtonPosition({ x: TRAFFIC_LIGHTS_X, y });
}

function secureWebPreferences(preload: boolean): Electron.WebPreferences {
  return {
    ...(preload ? { preload: path.join(import.meta.dirname, "../preload/index.cjs") } : {}),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    spellcheck: true,
  };
}

/**
 * The main window stays on the bundled UI. Server pages it opens, like an
 * uploaded image, get their own window, signed in like the UI. Everything
 * else opens in the default browser.
 */
function guardContents(contents: WebContents, home: string): void {
  contents.on("will-navigate", (event, url) => {
    if (hasOrigin(url, home)) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (hasOrigin(url, getServerOrigin())) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1000,
          height: 760,
          minWidth: 420,
          minHeight: 320,
          backgroundColor: backgroundColor(),
          webPreferences: secureWebPreferences(false),
        },
      };
    }
    openExternal(url);
    return { action: "deny" };
  });
  contents.on("did-create-window", (child, { url }) => {
    guardContents(child.webContents, originOf(url) ?? "");
    attachContextMenu(child.webContents);
  });
  attachContextMenu(contents);
}

function createWindow(): BrowserWindow {
  const bounds = restoredBounds();
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 420,
    minHeight: 480,
    show: false,
    title: app.name,
    backgroundColor: backgroundColor(),
    ...(isMac
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: {
            x: TRAFFIC_LIGHTS_X,
            y: Math.round((TITLEBAR_HEIGHT - TRAFFIC_LIGHTS_HEIGHT) / 2),
          },
        }
      : {}),
    webPreferences: secureWebPreferences(true),
  });
  if (bounds.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  win.on("close", (event) => {
    if (quitting || !isMac || win !== mainWindow) return;
    // Closing hides the window on macOS so reopening is instant and keeps state.
    event.preventDefault();
    if (win.isFullScreen()) {
      win.once("leave-full-screen", () => win.hide());
      win.setFullScreen(false);
    } else {
      win.hide();
    }
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.on("resize", () => saveBounds(win));
  win.on("move", () => saveBounds(win));
  win.on("maximize", () => saveBounds(win));
  win.on("unmaximize", () => saveBounds(win));
  win.on("enter-full-screen", () => win.webContents.send(IPC.fullscreen, true));
  win.on("leave-full-screen", () => win.webContents.send(IPC.fullscreen, false));
  win.on("swipe", (_event, direction) => {
    if (direction === "right") navigateHistory("back");
    if (direction === "left") navigateHistory("forward");
  });

  const contents = win.webContents;
  guardContents(contents, APP_ORIGIN);
  contents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
  contents.on("did-navigate", () => {
    contents.setZoomLevel(getZoomLevel());
    syncTrafficLights(win);
  });
  contents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") contents.reload();
  });

  void win.loadURL(APP_URL);
  return win;
}

/** Shows the main window, creating it if needed. */
export function openMainWindow(): void {
  const existing = getMainWindow();
  if (existing) {
    existing.show();
    return;
  }
  mainWindow = createWindow();
}

/** Starts the UI over, e.g. after the server changes. */
export function restartUi(): void {
  getMainWindow()?.loadURL(APP_URL);
}

/** Sends a menu command to the UI. */
export function sendCommand(command: DesktopCommand): void {
  const win = getMainWindow();
  if (!win) {
    openMainWindow();
    return;
  }
  win.show();
  win.webContents.send(IPC.command, command);
}

export function navigateHistory(direction: "back" | "forward"): void {
  const history = getMainWindow()?.webContents.navigationHistory;
  if (!history) return;
  if (direction === "back" && history.canGoBack()) history.goBack();
  if (direction === "forward" && history.canGoForward()) history.goForward();
}

export function reloadPage(ignoreCache = false): void {
  const contents = getMainWindow()?.webContents;
  if (!contents) return;
  if (ignoreCache) contents.reloadIgnoringCache();
  else contents.reload();
}

export function changeZoom(step: -1 | 0 | 1): void {
  const win = getMainWindow();
  if (!win) return;
  const current = win.webContents.getZoomLevel();
  let next = 0;
  if (step === 1) next = ZOOM_LEVELS.find((level) => level > current + 0.01) ?? current;
  if (step === -1) next = [...ZOOM_LEVELS].reverse().find((level) => level < current - 0.01) ?? current;
  win.webContents.setZoomLevel(next);
  setZoomLevel(next);
  syncTrafficLights(win);
}
