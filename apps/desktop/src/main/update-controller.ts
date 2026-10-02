import type { DesktopUpdateState } from "@overtchat/shared/desktop";
import type { AppUpdaterEvents } from "electron-updater/out/AppUpdater";

export interface UpdatePort {
  on<K extends keyof AppUpdaterEvents>(event: K, listener: AppUpdaterEvents[K]): unknown;
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
}

/** Checks discover updates; downloading and restarting require an explicit action. */
export function createUpdateController(
  port: UpdatePort,
  currentVersion: string,
  unsupported: string | null,
  publish: (state: DesktopUpdateState) => void,
) {
  let state: DesktopUpdateState = {
    currentVersion,
    status: unsupported ? "unsupported" : "idle",
    availableVersion: null,
    downloadPercent: null,
    message: unsupported,
  };
  let checking: Promise<DesktopUpdateState> | null = null;
  let downloading: Promise<DesktopUpdateState> | null = null;
  let downloadedVersion: string | null = null;

  function update(next: Partial<DesktopUpdateState>): void {
    state = { ...state, ...next };
    publish({ ...state });
  }

  function fail(error: unknown): void {
    update({
      status: downloadedVersion ? "ready" : "error",
      availableVersion: downloadedVersion ?? state.availableVersion,
      message: error instanceof Error ? error.message : "Could not update the desktop app. Try again.",
    });
  }

  if (!unsupported) {
    port.on("checking-for-update", () => update({ status: "checking", message: null }));
    port.on("update-available", ({ version }) => {
      if (version === downloadedVersion) {
        update({ status: "ready", availableVersion: version, message: null });
      } else {
        downloadedVersion = null;
        update({ status: "available", availableVersion: version, downloadPercent: null, message: null });
      }
    });
    port.on("update-not-available", () => {
      if (state.status === "blocked") return;
      update({ status: downloadedVersion ? "ready" : "idle", availableVersion: downloadedVersion, downloadPercent: null, message: null });
    });
    port.on("download-progress", ({ percent }) => update({
      status: "downloading",
      downloadPercent: Math.max(0, Math.min(100, Math.floor(percent))),
    }));
    port.on("update-downloaded", ({ version }) => {
      downloadedVersion = version;
      update({ status: "ready", availableVersion: version, downloadPercent: 100, message: null });
    });
    port.on("error", fail);
  }

  return {
    getState: (): DesktopUpdateState => ({ ...state }),
    block(version: string, message: string): void {
      downloadedVersion = null;
      update({ status: "blocked", availableVersion: version, downloadPercent: null, message });
    },
    check(): Promise<DesktopUpdateState> {
      if (unsupported || state.status === "downloading" || state.status === "installing") {
        return Promise.resolve({ ...state });
      }
      if (checking) return checking;
      checking = (async () => {
        try {
          const result = await port.checkForUpdates();
          // electron-updater also emits an error; handle the promise rejection
          // so a background download can never become an unhandled rejection.
          void result?.downloadPromise?.catch(fail);
        } catch (error) {
          fail(error);
        }
        return { ...state };
      })().finally(() => { checking = null; });
      return checking;
    },
    download(): Promise<DesktopUpdateState> {
      if (downloading) return downloading;
      if (unsupported || !state.availableVersion || !["available", "error"].includes(state.status)) {
        return Promise.resolve({ ...state });
      }
      update({ status: "downloading", downloadPercent: 0, message: null });
      downloading = (async () => {
        try { await port.downloadUpdate(); } catch (error) { fail(error); }
        return { ...state };
      })().finally(() => { downloading = null; });
      return downloading;
    },
    install(beforeInstall?: () => void): void {
      if (state.status !== "ready" || !downloadedVersion) {
        throw new Error("Download the desktop update before restarting.");
      }
      update({ status: "installing", message: null });
      // Let the IPC reply reach the renderer before Electron closes the window.
      setTimeout(() => {
        try {
          beforeInstall?.();
          port.quitAndInstall(false, true);
        } catch (error) { fail(error); }
      }, 200);
    },
  };
}
