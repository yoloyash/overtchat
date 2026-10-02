import { app, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { clearServer } from "./settings";
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
  restartUi();
}

export function installMenu(): void {
  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: "about" },
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
