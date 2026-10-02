import { app } from "electron";
import path from "node:path";
import { configureServerAuth } from "./auth";
import { registerIpc } from "./ipc";
import { installMenu } from "./menu";
import { configurePermissions } from "./permissions";
import { handleAppScheme, registerAppScheme } from "./protocol";
import { flushSettings, loadSettings } from "./settings";
import { getMainWindow, openMainWindow } from "./window";

app.setName("overtchat");
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

    app.on("activate", () => {
      openMainWindow();
    });
  });

  app.on("before-quit", flushSettings);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
