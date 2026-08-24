#!/usr/bin/env node
/* global console, process */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function imagePlatforms(value) {
  const entries = Array.isArray(value) ? value : [value];
  return new Set(
    entries.flatMap((entry) => {
      const platform = entry?.Descriptor?.platform;
      return typeof platform?.os === "string" &&
          typeof platform?.architecture === "string"
        ? [`${platform.os}/${platform.architecture}`]
        : [];
    }),
  );
}

export function assertImagePlatforms(value, expected) {
  const actual = imagePlatforms(value);
  const missing = expected.filter((platform) => !actual.has(platform));
  if (missing.length > 0) {
    throw new Error(
      `Image is missing required platforms: ${missing.join(", ")}. Found: ${[
        ...actual,
      ].sort().join(", ") || "none"}.`,
    );
  }
}

async function main() {
  const [manifestPath, ...expected] = process.argv.slice(2);
  if (!manifestPath || expected.length === 0) {
    throw new Error(
      "Usage: assert-image-platforms.mjs <manifest.json> <os/architecture>...",
    );
  }
  assertImagePlatforms(
    JSON.parse(await readFile(manifestPath, "utf8")),
    expected,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
