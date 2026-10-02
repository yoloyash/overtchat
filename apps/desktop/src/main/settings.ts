import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ColorScheme } from "../shared/ipc";

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

interface Settings {
  /** Origin of the server the app is connected to. */
  serverOrigin: string | null;
  /** The address last entered on the connect screen. */
  lastAddress: string;
  /** The server's session token, encrypted with `safeStorage`, in base64. */
  sessionToken: string | null;
  window: WindowBounds | null;
  zoomLevel: number;
  colorScheme: ColorScheme | null;
}

const DEFAULTS: Settings = {
  serverOrigin: null,
  lastAddress: "",
  sessionToken: null,
  window: null,
  zoomLevel: 0,
  colorScheme: null,
};

let settings: Settings = DEFAULTS;
let writeTimer: NodeJS.Timeout | null = null;
/** Decrypted once; requests read it on every call. */
let token: string | null = null;

function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

/** Linux's basic backend uses a public fallback key, not an OS secret store. */
function canPersistSession(): boolean {
  return safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
}

export function loadSettings(): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as Partial<Settings>;
    // Only known keys, so fields from older builds don't linger in the file.
    settings = Object.fromEntries(
      Object.entries(DEFAULTS).map(([key, value]) => [key, parsed[key as keyof Settings] ?? value]),
    ) as unknown as Settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[settings] failed to read; starting fresh", error);
    }
    settings = DEFAULTS;
  }
  token = null;
  if (settings.sessionToken) {
    try {
      if (!canPersistSession()) throw new Error("OS credential storage is unavailable");
      token = safeStorage.decryptString(Buffer.from(settings.sessionToken, "base64"));
    } catch (error) {
      console.error("[settings] failed to decrypt the session token; sign in again", error);
      settings = { ...settings, sessionToken: null };
    }
  }
}

/** Writes are coalesced; window moves update settings often. */
function persist(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(flushSettings, 250);
}

export function flushSettings(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  const file = settingsFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  } catch (error) {
    console.error("[settings] failed to save", error);
  }
}

function update(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  persist();
}

export function getServerOrigin(): string | null {
  return settings.serverOrigin;
}

export function getLastAddress(): string {
  return settings.lastAddress;
}

/** Connects to a server. A different server starts signed out. */
export function setServer(origin: string, address: string): void {
  if (origin !== settings.serverOrigin) setSessionToken(null);
  update({ serverOrigin: origin, lastAddress: address });
}

export function clearServer(): void {
  setSessionToken(null);
  update({ serverOrigin: null });
}

export function getSessionToken(): string | null {
  return token;
}

/**
 * Stores the server's session token. Without OS encryption it is kept for
 * this run only, so it never reaches disk in plain text.
 */
export function setSessionToken(next: string | null): void {
  if (next === token) return;
  token = next;
  if (next && !canPersistSession()) {
    console.warn("[settings] OS encryption is unavailable; the sign-in lasts until the app quits");
    update({ sessionToken: null });
    return;
  }
  update({
    sessionToken: next ? safeStorage.encryptString(next).toString("base64") : null,
  });
}

export function getWindowBounds(): WindowBounds | null {
  return settings.window;
}

export function setWindowBounds(bounds: WindowBounds): void {
  update({ window: bounds });
}

export function getZoomLevel(): number {
  return settings.zoomLevel;
}

export function setZoomLevel(zoomLevel: number): void {
  update({ zoomLevel });
}

export function getColorScheme(): ColorScheme | null {
  return settings.colorScheme;
}

export function setColorScheme(colorScheme: ColorScheme): void {
  if (settings.colorScheme !== colorScheme) update({ colorScheme });
}
