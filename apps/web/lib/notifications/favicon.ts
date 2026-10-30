"use client";

import { desktopBridge } from "@/lib/desktop";

const BADGE_COLOR = "#e5484d";

let original: string | null = null;
/** The count last applied; a reload applies its first count whatever it is. */
let shown = -1;
let generation = 0;

/**
 * Counts the sessions that need the owner on the favicon and, in the desktop
 * app, on the dock or taskbar icon.
 */
export function showAgentAttentionBadge(count: number): void {
  if (count === shown) return;
  shown = count;
  const token = ++generation;
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (link) {
    original ??= link.href;
    if (count === 0) {
      link.href = original;
    } else {
      const icon = new Image();
      icon.onload = () => {
        if (token === generation) link.href = badgedFavicon(icon, count);
      };
      icon.src = original;
    }
  }
  void desktopBridge()
    ?.setBadge?.({ count, image: count > 0 ? overlayBadge(count) : null })
    .catch(() => undefined);
}

function badgeText(count: number): string {
  return count > 9 ? "9+" : String(count);
}

function drawBadge(
  context: CanvasRenderingContext2D,
  count: number,
  x: number,
  y: number,
  radius: number,
): void {
  context.fillStyle = BADGE_COLOR;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fff";
  context.font = `700 ${Math.round(radius * (count > 9 ? 1.05 : 1.3))}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(badgeText(count), x, y + radius * 0.06);
}

function badgedFavicon(icon: HTMLImageElement, count: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return icon.src;
  context.drawImage(icon, 0, 0, 64, 64);
  drawBadge(context, count, 46, 46, 17);
  return canvas.toDataURL("image/png");
}

/** A badge on its own, for a taskbar overlay. */
function overlayBadge(count: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return null;
  drawBadge(context, count, 16, 16, 15);
  return canvas.toDataURL("image/png");
}
