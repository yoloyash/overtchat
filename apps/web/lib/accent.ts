import { ACCENT_OPTIONS, DEFAULT_ACCENT_ID, resolveAccentId } from "@overtchat/shared";

export const ACCENT_STORAGE_KEY = "overtchat_accent";
export const ACCENT_ATTRIBUTE = "data-accent";

export function applyAccent(value: unknown): void {
  document.documentElement.setAttribute(ACCENT_ATTRIBUTE, resolveAccentId(value));
}

// Apply before first paint, just like the saved font and light/dark preference.
export const accentScript = `(function(){try{
  var raw=localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)});
  var id=raw?JSON.parse(raw):null;
  var ids=${JSON.stringify(ACCENT_OPTIONS.map(({ id }) => id))};
  document.documentElement.setAttribute(${JSON.stringify(ACCENT_ATTRIBUTE)},ids.indexOf(id)>=0?id:${JSON.stringify(DEFAULT_ACCENT_ID)});
}catch(e){}})();`;
