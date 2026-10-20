import { EventEmitter } from "node:events";
import type { UpdatePort } from "./update-controller";

/** Used only by unpackaged development builds, never by an installed app. */
export function createUpdatePreview(currentVersion: string, mode: string) {
  if (!["idle", "available", "ready", "downloading", "error", "blocked"].includes(mode)) {
    throw new Error("OVERTCHAT_DESKTOP_UPDATE_PREVIEW must be idle, available, ready, downloading, error, or blocked.");
  }
  const events = new EventEmitter();
  const parts = currentVersion.split(".").map(Number);
  const version = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  const info = { version };
  const port: UpdatePort = {
    on: events.on.bind(events),
    async checkForUpdates() {
      events.emit("checking-for-update");
      events.emit("update-available", info);
      return null;
    },
    async downloadUpdate() {
      await new Promise<void>((resolve) => {
        events.emit("download-progress", { percent: 37 });
        setTimeout(() => { events.emit("update-downloaded", info); resolve(); }, 1500);
      });
    },
    quitAndInstall() {
      events.emit("error", new Error("Preview: restart requested. No update was installed."));
    },
  };
  return {
    port,
    begin(block: (version: string, message: string) => void) {
      switch (mode) {
        case "available": events.emit("update-available", info); break;
        case "ready": events.emit("update-downloaded", info); break;
        case "downloading":
          events.emit("update-available", info);
          events.emit("download-progress", { percent: 37 });
          break;
        case "error": events.emit("error", new Error("Preview: download failed. Try again.")); break;
        case "blocked": block(version, "This desktop update needs a newer server. Update your OvertChat server first, or ask its administrator, then check for desktop updates again."); break;
      }
    },
  };
}
