/**
 * What the OvertChat desktop app (`apps/desktop`) exposes to the UI it bundles.
 * The UI reads it from `window.overtchatDesktop`; it is absent on the web.
 */

/** Present on `<html>` when the UI draws under the desktop window's titlebar. */
export const DESKTOP_SHELL_ATTRIBUTE = "data-desktop-shell";

/** CSS length the window controls occupy at the titlebar's leading edge. */
export const DESKTOP_TITLEBAR_INSET_PROPERTY = "--desktop-titlebar-inset";

/** Commands the desktop menus send to the UI. */
export const DESKTOP_COMMANDS = [
  "new-chat",
  "search-chats",
  "open-settings",
  "toggle-sidebar",
] as const;

export type DesktopCommand = (typeof DESKTOP_COMMANDS)[number];

export interface DesktopBridge {
  /** Subscribes to menu commands and returns an unsubscribe function. */
  onCommand(listener: (command: DesktopCommand) => void): () => void;
  /** Forgets the active server and its sign-in, then shows the connect screen. */
  changeServer(): Promise<void>;
}
