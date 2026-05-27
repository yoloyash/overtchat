// Generates the four image assets app.json points at:
//   assets/icon.png            — 1024x1024, "o" on #23261f (iOS + fallback)
//   assets/adaptive-icon.png   — 1024x1024, "o" centered in safe zone, transparent bg
//   assets/splash-icon.png     — 1024x1024, "o" only, transparent (light mode splash)
//   assets/splash-icon-dark.png — same, used for dark mode splash
//
// Run: node scripts/generate-icons.mjs (from apps/mobile/).

import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const fontDir = resolve(
  root,
  "../../node_modules/@expo-google-fonts/fraunces/600SemiBold",
);

// Configure fontconfig to find Fraunces 600 SemiBold without touching the
// user's system. librsvg uses pango+fontconfig to render <text>.
const fcDir = join(tmpdir(), `fc-overtchat-${Date.now()}`);
mkdirSync(join(fcDir, "cache"), { recursive: true });
writeFileSync(
  join(fcDir, "fonts.conf"),
  `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontDir}</dir>
  <cachedir>${fcDir}/cache</cachedir>
</fontconfig>`,
);
process.env.FONTCONFIG_FILE = join(fcDir, "fonts.conf");

const BG = "#23261f";
const FG = "#f5f5f0";

// Fraunces "o" has a low x-height and sits on the baseline; nudge y so
// the optical center lands at 50%. fontSize/baseline picked by eye.
function letterSvg({ size, color, fontSize, y }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <text x="${size / 2}" y="${y}" font-family="Fraunces" font-weight="600" font-size="${fontSize}" text-anchor="middle" fill="${color}">o</text>
</svg>`;
}

function bgSvg({ size, color }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${color}"/></svg>`;
}

async function compose({ size, fg, bg, letterSize, letterY, out }) {
  const layers = [];
  if (bg) {
    layers.push({
      input: Buffer.from(bgSvg({ size, color: bg })),
      density: 72,
    });
  }
  layers.push({
    input: Buffer.from(
      letterSvg({ size, color: fg, fontSize: letterSize, y: letterY }),
    ),
    density: 72,
  });
  // Start from a transparent canvas at exact pixel size, composite the SVGs
  // (rasterized at density 72 so 1 SVG unit == 1 px) on top.
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png()
    .toFile(out);
  console.log("wrote", out);
}

const SIZE = 1024;
const assetsDir = resolve(root, "assets");
mkdirSync(assetsDir, { recursive: true });

// iOS / fallback icon: full-bleed bg, "o" near full size.
await compose({
  size: SIZE,
  bg: BG,
  fg: FG,
  letterSize: 800,
  letterY: 700,
  out: join(assetsDir, "icon.png"),
});

// Android adaptive icon foreground: transparent bg, "o" inside the
// 66% safe zone (Android masks/clips the outer ~17%). Letter ~520 px feels right.
await compose({
  size: SIZE,
  bg: null,
  fg: FG,
  letterSize: 520,
  letterY: 624,
  out: join(assetsDir, "adaptive-icon.png"),
});

// Splash logo: just the "o", expo-splash-screen places it on the
// configured background color. Light + dark variants use opposite fg colors.
await compose({
  size: SIZE,
  bg: null,
  fg: BG,
  letterSize: 800,
  letterY: 700,
  out: join(assetsDir, "splash-icon.png"),
});

await compose({
  size: SIZE,
  bg: null,
  fg: FG,
  letterSize: 800,
  letterY: 700,
  out: join(assetsDir, "splash-icon-dark.png"),
});
