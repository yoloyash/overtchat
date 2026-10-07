import { ACCENT_OPTIONS, DEFAULT_ACCENT_ID, resolveAccentId } from "@overtchat/shared";
import { accentBackgrounds } from "@overtchat/shared/theme-backgrounds";

export const ACCENT_STORAGE_KEY = "overtchat_accent";
export const ACCENT_ATTRIBUTE = "data-accent";

export function applyAccent(value: unknown): void {
  document.documentElement.setAttribute(ACCENT_ATTRIBUTE, resolveAccentId(value));
}

export function applyThemeColor(value: unknown, scheme: "light" | "dark"): void {
  const color = accentBackgrounds[resolveAccentId(value)][scheme];
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = color;
}

// Own the chrome meta outside React: mutating server metadata before hydration
// can make React hoist a duplicate tag. This runs before the UI's first paint.
export const accentScript = `(function(){
  var id=null,theme=null;
  try{
    theme=localStorage.getItem("theme");
    var raw=localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)});
    id=raw?JSON.parse(raw):null;
  }catch(e){}
  var ids=${JSON.stringify(ACCENT_OPTIONS.map(({ id }) => id))};
  id=ids.indexOf(id)>=0?id:${JSON.stringify(DEFAULT_ACCENT_ID)};
  document.documentElement.setAttribute(${JSON.stringify(ACCENT_ATTRIBUTE)},id);
  var dark=theme==="dark"||(theme!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);
  var meta=document.createElement("meta");
  meta.name="theme-color";
  meta.content=${JSON.stringify(accentBackgrounds)}[id][dark?"dark":"light"];
  document.head.appendChild(meta);
})();`;
