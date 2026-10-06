import { app, powerMonitor } from "electron";
import { autoUpdater, DebUpdater, RpmUpdater } from "electron-updater";
import { CLIENT_API_LEVEL } from "@overtchat/shared";
import { IPC } from "../shared/ipc";
import { getMainWindow } from "./window";
import { createUpdateController } from "./update-controller";
import { getServerOrigin } from "./settings";
import { pingServer } from "./server";
import { updateCompatibilityMessage } from "./update-policy";
import { createUpdatePreview } from "./update-preview";
import { startUpdateScheduler } from "./update-scheduler";

const preview = !app.isPackaged && process.env.OVERTCHAT_DESKTOP_UPDATE_PREVIEW
  ? createUpdatePreview(app.getVersion(), process.env.OVERTCHAT_DESKTOP_UPDATE_PREVIEW) : null;
const unsupported = preview ? null : !app.isPackaged
  ? "Automatic updates are available in installed release builds."
  : process.platform === "linux" && !process.env.APPIMAGE && !(autoUpdater instanceof DebUpdater) && !(autoUpdater instanceof RpmUpdater)
    ? "Tar archive installations update manually. Download and replace the desktop app, or install an AppImage, .deb, or .rpm for in-app updates."
    : process.platform !== "darwin" && process.platform !== "linux"
      ? "Automatic updates are not available on this platform."
      : null;

export const desktopUpdates = createUpdateController(preview?.port ?? autoUpdater, app.getVersion(), unsupported, (state) => {
  getMainWindow()?.webContents.send(IPC.updateStateChanged, state);
});

let expectedApiLevel = CLIENT_API_LEVEL;
let downloadedApiLevel: unknown = null;
let updateOrigin: string | null = null;
let checkPending: Promise<ReturnType<typeof desktopUpdates.getState>> | null = null;

/** Also works for a newer server entered on the connect screen. */
export function setUpdateOrigin(origin: string | null): void {
  updateOrigin = origin;
}

async function targetApiLevel(): Promise<number> {
  const origin = updateOrigin ?? getServerOrigin();
  if (!origin) return CLIENT_API_LEVEL;
  const result = await pingServer(origin);
  // Offline checks only accept the installed client's API level.
  return result.ok ? result.apiLevel : CLIENT_API_LEVEL;
}

export function checkDesktopUpdates(): Promise<ReturnType<typeof desktopUpdates.getState>> {
  const state = desktopUpdates.getState();
  if (unsupported || ["downloading", "installing"].includes(state.status)) return Promise.resolve(state);
  if (checkPending) return checkPending;
  checkPending = (async () => {
    if (!preview) expectedApiLevel = await targetApiLevel();
    return desktopUpdates.check();
  })().finally(() => { checkPending = null; });
  return checkPending;
}

export async function installDesktopUpdate(): Promise<void> {
  if (preview) return desktopUpdates.install();
  const state = desktopUpdates.getState();
  if (state.status !== "ready" || !state.availableVersion) {
    throw new Error("Download the desktop update before restarting.");
  }
  const origin = updateOrigin ?? getServerOrigin();
  const candidateApiLevel = downloadedApiLevel;
  const serverApiLevel = await targetApiLevel();
  const assertUnchanged = () => {
    const current = desktopUpdates.getState();
    if ((updateOrigin ?? getServerOrigin()) !== origin
      || current.availableVersion !== state.availableVersion
      || downloadedApiLevel !== candidateApiLevel
      || !["ready", "installing"].includes(current.status)) {
      throw new Error("The server or desktop update changed. Try updating again.");
    }
  };
  assertUnchanged();
  const message = updateCompatibilityMessage(candidateApiLevel, serverApiLevel);
  if (message) {
    desktopUpdates.block(state.availableVersion, message);
    throw new Error(message);
  }
  desktopUpdates.install(assertUnchanged);
}

export async function downloadDesktopUpdate(): Promise<ReturnType<typeof desktopUpdates.getState>> {
  const state = desktopUpdates.getState();
  if (unsupported || ["ready", "downloading", "installing"].includes(state.status)) return state;
  // Refresh compatibility and the provider's metadata before every download/retry.
  const checked = await checkDesktopUpdates();
  return checked.status === "available" ? desktopUpdates.download() : checked;
}

export function startUpdates(): void {
  if (preview) { preview.begin(desktopUpdates.block); return; }
  if (unsupported) return;
  // Builder supplies app-update.yml; only the architecture-specific channel varies.
  autoUpdater.channel = process.platform === "darwin" ? `stable-${process.arch}` : "stable";
  const supportsSystem = autoUpdater.isUpdateSupported;
  autoUpdater.isUpdateSupported = async (info) => {
    if (!await supportsSystem(info)) return false;
    if (autoUpdater.currentVersion.compare(info.version) >= 0) return true;
    const level = (info as typeof info & { clientApiLevel?: unknown }).clientApiLevel;
    const message = updateCompatibilityMessage(level, expectedApiLevel);
    if (!message) return true;
    desktopUpdates.block(info.version, message);
    return false;
  };
  autoUpdater.on("update-downloaded", (info) => {
    downloadedApiLevel = (info as typeof info & { clientApiLevel?: unknown }).clientApiLevel;
  });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  // Release downloads are immutable full archives; blockmaps are not published.
  autoUpdater.disableDifferentialDownload = true;
  startUpdateScheduler(() => {
    void checkDesktopUpdates().catch((error) => {
      console.error("Could not check for desktop updates", error);
    });
  }, app, powerMonitor);
}
