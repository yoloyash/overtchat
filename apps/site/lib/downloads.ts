import type { ProductRelease, ReleaseAsset } from "./releases";

export const GOOGLE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.overtchat.mobile";
export const APP_STORE_URL =
  "https://apps.apple.com/us/app/overtchat/id6812165221";

// Releases are normalized (public, stable, newest publication first) by the
// shared GitHub loader. Never mix installers from different desktop releases.
export function getDownloads(releases: ProductRelease[]) {
  const desktop = releases.find((release) => release.platform === "desktop");
  if (!desktop) throw new Error("No stable desktop release available for downloads");
  const version = desktop.tagName.replace(/^desktop-v/i, "");

  const requiredAsset = (...names: string[]): ReleaseAsset => {
    const asset = desktop.assets.find((asset) => names.includes(asset.name));
    if (!asset) {
      throw new Error(`Missing download in ${desktop.tagName}: ${names.join(" or ")}`);
    }
    return asset;
  };

  const mobile = releases.find((release) => release.platform === "mobile");
  const apk = mobile?.assets.find(
    (asset) => asset.name === `overtchat-v${mobile.tagName.replace(/^mobile-v/i, "")}.apk`,
  );

  return {
    desktop,
    version,
    macArm: requiredAsset(`overtchat-${version}-mac-arm64.dmg`),
    macIntel: requiredAsset(`overtchat-${version}-mac-x64.dmg`),
    deb: requiredAsset(`overtchat-${version}-linux-x64.deb`),
    rpm: requiredAsset(`overtchat-${version}-linux-x64.rpm`),
    appImage: requiredAsset(
      "overtchat-linux-x64.AppImage",
      `overtchat-${version}-linux-x64.AppImage`,
    ),
    apk,
  };
}
