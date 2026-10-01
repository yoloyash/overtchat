import { app, session, systemPreferences } from "electron";
import fs from "node:fs";
import path from "node:path";
import { APP_ORIGIN, originOf } from "./protocol";

/** Browser permissions the UI uses: dictation and voice, notifications, copy. */
const GRANTED = new Set(["media", "notifications", "clipboard-sanitized-write", "fullscreen"]);

function fromApp(url: string | undefined): boolean {
  return !!url && originOf(url) === APP_ORIGIN;
}

/** Saves next to existing files the way browsers do: "name (1).ext". */
function uniqueDownloadPath(filename: string): string {
  const directory = app.getPath("downloads");
  const { name, ext } = path.parse(path.basename(filename) || "download");
  let candidate = path.join(directory, `${name}${ext}`);
  for (let n = 1; fs.existsSync(candidate); n += 1) {
    candidate = path.join(directory, `${name} (${n})${ext}`);
  }
  return candidate;
}

export function configurePermissions(): void {
  const ses = session.defaultSession;

  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return GRANTED.has(permission) && fromApp(requestingOrigin);
  });

  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    if (!GRANTED.has(permission) || !fromApp(details.requestingUrl)) {
      callback(false);
      return;
    }
    if (permission !== "media") {
      callback(true);
      return;
    }
    const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    // The UI only records audio; camera and screen capture stay off.
    if (mediaTypes.some((type) => type !== "audio")) {
      callback(false);
      return;
    }
    if (process.platform !== "darwin") {
      callback(true);
      return;
    }
    systemPreferences
      .askForMediaAccess("microphone")
      .then(callback)
      .catch(() => callback(false));
  });

  ses.on("will-download", (_event, item) => {
    const target = uniqueDownloadPath(item.getFilename());
    item.setSavePath(target);
    item.once("done", (_doneEvent, state) => {
      if (state === "completed" && process.platform === "darwin") app.dock?.downloadFinished(target);
    });
  });
}
