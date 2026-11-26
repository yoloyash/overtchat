import { app, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { i18n } from "@overtchat/shared/i18n";
import { clearServer } from "./settings";
import { checkDesktopUpdates, downloadDesktopUpdate, installDesktopUpdate, setUpdateOrigin } from "./updates";
import {
  changeZoom,
  navigateHistory,
  reloadPage,
  restartUi,
  sendCommand,
} from "./window";

const isMac = process.platform === "darwin";

function changeServer(): void {
  clearServer();
  setUpdateOrigin(null);
  restartUi();
}

async function checkUpdates(): Promise<void> {
  const state = await checkDesktopUpdates();
  const ready = state.status === "ready";
  const available = state.status === "available";
  const t = i18n.t;
  const version = state.availableVersion;
  const { response } = await dialog.showMessageBox({
    type: state.status === "error" ? "error" : "info",
    title: t("app.desktopNative.updates.title"),
    message: ready ? t("app.desktopNative.updates.ready", { version })
      : available ? t("app.desktopNative.updates.available", { version })
      : state.status === "downloading" ? t("app.desktopNative.updates.downloading", { version })
        : state.message ?? t("app.desktopNative.updates.none"),
    detail: t("app.desktopNative.updates.installed", { version: state.currentVersion }),
    buttons: ready
      ? [t("app.desktopNative.updates.later"), t("app.desktopNative.updates.restart")]
      : available
        ? [t("app.desktopNative.updates.later"), t("app.desktopNative.updates.download")]
        : [t("app.desktopNative.updates.ok")],
    defaultId: 0,
    cancelId: 0,
  });
  if ((ready || available) && response === 1) {
    try {
      if (ready) await installDesktopUpdate();
      else await downloadDesktopUpdate();
    } catch (error) {
      dialog.showErrorBox(t("app.desktopNative.updates.failedTitle"), error instanceof Error ? error.message : t("app.desktopNative.updates.failedDetail"));
    }
  }
}

/** Builds the menus in the active language; called again when it changes. */
export function installMenu(): void {
  const t = i18n.t;
  const name = app.name;
  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: "about", label: t("app.desktopNative.menu.about", { name }) },
            { label: t("app.desktopNative.menu.checkForUpdates"), click: () => { void checkUpdates(); } },
            { type: "separator" },
            { label: t("app.desktopNative.menu.settingsMac"), accelerator: "Cmd+,", click: () => sendCommand("open-settings") },
            { label: t("app.desktopNative.menu.changeServer"), click: changeServer },
            { type: "separator" },
            { role: "services", label: t("app.desktopNative.menu.services") },
            { type: "separator" },
            { role: "hide", label: t("app.desktopNative.menu.hide", { name }) },
            { role: "hideOthers", label: t("app.desktopNative.menu.hideOthers") },
            { role: "unhide", label: t("app.desktopNative.menu.showAll") },
            { type: "separator" },
            { role: "quit", label: t("app.desktopNative.menu.quitNamed", { name }) },
          ],
        },
      ]
    : [];

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: t("app.desktopNative.menu.file"),
      submenu: [
        { label: t("app.desktopNative.menu.newChat"), accelerator: "CmdOrCtrl+N", click: () => sendCommand("new-chat") },
        { type: "separator" },
        ...(isMac
          ? []
          : ([
              { label: t("app.desktopNative.menu.settings"), accelerator: "Ctrl+,", click: () => sendCommand("open-settings") },
              { label: t("app.desktopNative.menu.changeServer"), click: changeServer },
              { type: "separator" },
            ] satisfies MenuItemConstructorOptions[])),
        isMac
          ? { role: "close", label: t("app.desktopNative.menu.closeWindow") }
          : { role: "quit", label: t(process.platform === "win32" ? "app.desktopNative.menu.exit" : "app.desktopNative.menu.quit") },
      ],
    },
    {
      label: t("app.desktopNative.menu.edit"),
      submenu: [
        { role: "undo", label: t("app.desktopNative.menu.undo") },
        { role: "redo", label: t("app.desktopNative.menu.redo") },
        { type: "separator" },
        { role: "cut", label: t("app.desktopNative.menu.cut") },
        { role: "copy", label: t("app.desktopNative.menu.copy") },
        { role: "paste", label: t("app.desktopNative.menu.paste") },
        { role: "pasteAndMatchStyle", label: t("app.desktopNative.menu.pasteAndMatchStyle") },
        { role: "delete", label: t("app.desktopNative.menu.delete") },
        { role: "selectAll", label: t("app.desktopNative.menu.selectAll") },
        ...(isMac
          ? ([
              { type: "separator" },
              {
                label: t("app.desktopNative.menu.speech"),
                submenu: [
                  { role: "startSpeaking", label: t("app.desktopNative.menu.startSpeaking") },
                  { role: "stopSpeaking", label: t("app.desktopNative.menu.stopSpeaking") },
                ],
              },
            ] satisfies MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: t("app.desktopNative.menu.view"),
      submenu: [
        { label: t("app.desktopNative.menu.toggleSidebar"), accelerator: isMac ? "Ctrl+Cmd+S" : "Ctrl+Shift+S", click: () => sendCommand("toggle-sidebar") },
        {
          label: t("app.desktopNative.menu.searchChats"),
          accelerator: "CmdOrCtrl+K",
          // The web UI binds this key itself; the menu item only advertises it.
          registerAccelerator: false,
          click: () => sendCommand("search-chats"),
        },
        { type: "separator" },
        { label: t("app.desktopNative.menu.reload"), accelerator: "CmdOrCtrl+R", click: () => reloadPage() },
        { label: t("app.desktopNative.menu.forceReload"), accelerator: "Shift+CmdOrCtrl+R", click: () => reloadPage(true) },
        { role: "toggleDevTools", label: t("app.desktopNative.menu.toggleDevTools") },
        { type: "separator" },
        { label: t("app.desktopNative.menu.actualSize"), accelerator: "CmdOrCtrl+0", click: () => changeZoom(0) },
        { label: t("app.desktopNative.menu.zoomIn"), accelerator: "CmdOrCtrl+Plus", click: () => changeZoom(1) },
        {
          label: t("app.desktopNative.menu.zoomIn"),
          accelerator: "CmdOrCtrl+=",
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => changeZoom(1),
        },
        { label: t("app.desktopNative.menu.zoomOut"), accelerator: "CmdOrCtrl+-", click: () => changeZoom(-1) },
        { type: "separator" },
        { role: "togglefullscreen", label: t("app.desktopNative.menu.toggleFullScreen") },
      ],
    },
    {
      label: t("app.desktopNative.menu.go"),
      submenu: [
        { label: t("app.desktopNative.menu.back"), accelerator: "CmdOrCtrl+[", click: () => navigateHistory("back") },
        { label: t("app.desktopNative.menu.forward"), accelerator: "CmdOrCtrl+]", click: () => navigateHistory("forward") },
      ],
    },
    {
      role: "window",
      label: t("app.desktopNative.menu.window"),
      submenu: isMac
        ? [
            { role: "minimize", label: t("app.desktopNative.menu.minimize") },
            { role: "zoom", label: t("app.desktopNative.menu.zoom") },
            { type: "separator" },
            { role: "front", label: t("app.desktopNative.menu.bringAllToFront") },
          ]
        : [
            { role: "minimize", label: t("app.desktopNative.menu.minimize") },
            { role: "close", label: t("app.desktopNative.menu.closeWindow") },
          ],
    },
    {
      role: "help",
      label: t("app.desktopNative.menu.help"),
      submenu: [
        ...(!isMac ? [{ label: t("app.desktopNative.menu.checkForUpdates"), click: () => { void checkUpdates(); } }] : []),
        { label: t("app.desktopNative.menu.website"), click: () => void shell.openExternal("https://overtchat.com") },
        {
          label: t("app.desktopNative.menu.reportIssue"),
          click: () => void shell.openExternal("https://github.com/yoloyash/overtchat/issues"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  if (isMac) {
    app.dock?.setMenu(
      Menu.buildFromTemplate([{ label: t("app.desktopNative.menu.newChat"), click: () => sendCommand("new-chat") }]),
    );
  }
}
