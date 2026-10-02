import { app, dialog } from "electron";
import path from "node:path";
import { configureServerAuth } from "./auth";
import { registerIpc } from "./ipc";
import { installMenu } from "./menu";
import { configurePermissions } from "./permissions";
import { handleAppScheme, registerAppScheme } from "./protocol";
import { flushSettings, loadSettings } from "./settings";
import { getMainWindow, openMainWindow } from "./window";
import { startUpdates } from "./updates";

app.setName("overtchat");
// AppImage launchers can inject this switch when namespaces are unavailable.
// Refuse it before creating any renderer; sandbox:true cannot override it.
if (process.platform === "linux" && app.commandLine.hasSwitch("no-sandbox")) {
  dialog.showErrorBox("Cannot start overtchat",
    "OvertChat requires the Linux sandbox. Install the .deb or .rpm package, or use a system with working unprivileged user namespaces. See overtchat's Linux installation instructions.");
  app.exit(1);
}
// Development builds keep their own server, sign-in, and window state.
app.setPath(
  "userData",
  path.join(app.getPath("appData"), app.isPackaged ? "overtchat" : "overtchat-dev"),
);
app.enableSandbox();
registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = getMainWindow();
    if (!win) return openMainWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  void app.whenReady().then(() => {
    loadSettings();
    app.setAboutPanelOptions({
      applicationName: "overtchat",
      applicationVersion: app.getVersion(),
      copyright: "Self-hosted chat for local and hosted models.",
      website: "https://overtchat.com",
    });
    handleAppScheme();
    configureServerAuth();
    configurePermissions();
    registerIpc();
    installMenu();
    openMainWindow();
    startUpdates();

    app.on("activate", () => {
      openMainWindow();
    });
  });

  app.on("before-quit", flushSettings);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
