#!/usr/bin/env node
/* global console, process */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function assertOwnedImage(
  value,
  { revision, version, source, platforms },
) {
  for (const platform of platforms) {
    const singlePlatform = value?.image;
    const selectedImage = value?.image?.[platform] ??
      (`${singlePlatform?.os}/${singlePlatform?.architecture}` === platform
        ? singlePlatform
        : undefined);
    const labels = selectedImage?.config?.Labels;
    if (!labels) {
      throw new Error(`Image is missing required platform ${platform}.`);
    }
    const expected = {
      "org.opencontainers.image.revision": revision,
      "org.opencontainers.image.version": version,
      "org.opencontainers.image.source": source,
    };
    for (const [label, expectedValue] of Object.entries(expected)) {
      if (labels[label] !== expectedValue) {
        throw new Error(
          `Image ${platform} has ${label}=${labels[label] ?? "missing"}; expected ${expectedValue}.`,
        );
      }
    }
  }
}

async function main() {
  const [imagePath, revision, version, source, ...platforms] =
    process.argv.slice(2);
  if (!imagePath || !revision || !version || !source || platforms.length === 0) {
    throw new Error(
      "Usage: assert-owned-image.mjs <image.json> <revision> <version> <source> <os/architecture>...",
    );
  }
  assertOwnedImage(JSON.parse(await readFile(imagePath, "utf8")), {
    revision,
    version,
    source,
    platforms,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
