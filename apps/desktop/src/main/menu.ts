import { app, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";
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
  const { response } = await dialog.showMessageBox({
    type: state.status === "error" ? "error" : "info",
    title: "Desktop app updates",
    message: ready ? `Desktop v${state.availableVersion} is ready to install.`
      : available ? `Desktop v${state.availableVersion} is available.`
      : state.status === "downloading" ? `Downloading desktop v${state.availableVersion} in the background.`
        : state.message ?? "No compatible desktop update is available.",
    detail: `Installed desktop version: v${state.currentVersion}`,
    buttons: ready ? ["Later", "Restart to update"] : available ? ["Later", "Download update"] : ["OK"],
    defaultId: 0,
    cancelId: 0,
  });
  if ((ready || available) && response === 1) {
    try {
      if (ready) await installDesktopUpdate();
      else await downloadDesktopUpdate();
    } catch (error) {
      dialog.showErrorBox("Could not update the desktop app", error instanceof Error ? error.message : "Try checking for updates again.");
    }
  }
}

export function installMenu(): void {
  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: "about" },
            { label: "Check for Updates…", click: () => { void checkUpdates(); } },
            { type: "separator" },
            { label: "Settings…", accelerator: "Cmd+,", click: () => sendCommand("open-settings") },
            { label: "Change Server…", click: changeServer },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
      ]
    : [];

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: "File",
      submenu: [
        { label: "New Chat", accelerator: "CmdOrCtrl+N", click: () => sendCommand("new-chat") },
        { type: "separator" },
        ...(isMac
          ? []
          : ([
              { label: "Settings", accelerator: "Ctrl+,", click: () => sendCommand("open-settings") },
              { label: "Change Server…", click: changeServer },
              { type: "separator" },
            ] satisfies MenuItemConstructorOptions[])),
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        ...(isMac
          ? ([
              { type: "separator" },
              { label: "Speech", submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }] },
            ] satisfies MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Sidebar", accelerator: "Ctrl+Cmd+S", click: () => sendCommand("toggle-sidebar") },
        {
          label: "Search Chats",
          accelerator: "CmdOrCtrl+K",
          // The web UI binds this key itself; the menu item only advertises it.
          registerAccelerator: false,
          click: () => sendCommand("search-chats"),
        },
        { type: "separator" },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => reloadPage() },
        { label: "Force Reload", accelerator: "Shift+CmdOrCtrl+R", click: () => reloadPage(true) },
        { role: "toggleDevTools" },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => changeZoom(0) },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => changeZoom(1) },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => changeZoom(1),
        },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => changeZoom(-1) },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Go",
      submenu: [
        { label: "Back", accelerator: "CmdOrCtrl+[", click: () => navigateHistory("back") },
        { label: "Forward", accelerator: "CmdOrCtrl+]", click: () => navigateHistory("forward") },
      ],
    },
    {
      role: "window",
      submenu: isMac
        ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
        : [{ role: "minimize" }, { role: "close" }],
    },
    {
      role: "help",
      submenu: [
        ...(!isMac ? [{ label: "Check for Updates…", click: () => { void checkUpdates(); } }] : []),
        { label: "OvertChat Website", click: () => void shell.openExternal("https://overtchat.com") },
        {
          label: "Report an Issue",
          click: () => void shell.openExternal("https://github.com/yoloyash/overtchat/issues"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  if (isMac) {
    app.dock?.setMenu(
      Menu.buildFromTemplate([{ label: "New Chat", click: () => sendCommand("new-chat") }]),
    );
  }
}
