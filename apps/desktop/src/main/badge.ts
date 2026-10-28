import { app, nativeImage } from "electron";
import type { DesktopBadge } from "@overtchat/shared/desktop";
import { getMainWindow } from "./window";

/** A count on the dock icon; Windows has no count, so it gets the drawn badge. */
export function applyBadge(badge: DesktopBadge): void {
  const count =
    Number.isInteger(badge.count) && badge.count > 0 ? Math.min(badge.count, 999) : 0;
  if (process.platform === "win32") {
    const win = getMainWindow();
    if (!win) return;
    const image =
      count > 0 &&
      typeof badge.image === "string" &&
      badge.image.startsWith("data:image/png;base64,")
        ? nativeImage.createFromDataURL(badge.image)
        : null;
    win.setOverlayIcon(
      image,
      count > 0 ? `${count} agent${count === 1 ? "" : "s"} need you` : "",
    );
    return;
  }
  app.setBadgeCount(count);
}

export function clearBadge(): void {
  applyBadge({ count: 0, image: null });
}
