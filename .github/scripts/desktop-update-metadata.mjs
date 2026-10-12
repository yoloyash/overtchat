import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";

/** Adapt Builder's metadata after packaging; downloads remain immutable. */
export async function writeDesktopUpdateMetadata({ directory, version, apiLevel, platform, arch }) {
  assert(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version));
  assert(Number.isSafeInteger(apiLevel) && apiLevel > 0);
  assert(platform === "mac" ? ["arm64", "x64"].includes(arch) : ["linux", "windows"].includes(platform) && arch === "x64");
  const metadata = parse(await readFile(path.join(directory, platform === "windows" ? "latest.yml" : `latest-${platform}.yml`), "utf8"));
  assert.equal(metadata.version, version);
  const files = [];
  for (const extension of platform === "mac" ? ["zip"] : platform === "windows" ? ["exe"] : ["AppImage", "deb", "rpm"]) {
    const filename = extension === "AppImage" ? "overtchat-linux-x64.AppImage" : `overtchat-${version}-${platform}-${arch}.${extension}`;
    assert(metadata.files.some((file) => file.url === filename), `Builder metadata is missing ${filename}`);
    const artifact = path.join(directory, filename);
    files.push({
      url: `https://github.com/yoloyash/overtchat/releases/download/desktop-v${version}/${filename}`,
      sha512: createHash("sha512").update(await readFile(artifact)).digest("base64"),
      size: (await stat(artifact)).size,
    });
  }
  const result = {
    version,
    clientApiLevel: apiLevel,
    files,
    path: files[0].url,
    sha512: files[0].sha512,
    releaseDate: metadata.releaseDate,
    ...(metadata.minimumSystemVersion ? { minimumSystemVersion: metadata.minimumSystemVersion } : {}),
  };
  // electron-updater does not append a platform suffix for Windows channels.
  const channelFile = platform === "windows" ? "stable.yml" : `stable${platform === "mac" ? `-${arch}` : ""}-${platform}.yml`;
  await writeFile(path.join(directory, channelFile), stringify(result));
  return channelFile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [platform, arch] = process.argv.slice(2);
  const { CLIENT_API_LEVEL } = await import("../../packages/shared/src/ping.ts");
  const { version } = JSON.parse(await readFile("apps/desktop/package.json", "utf8"));
  const channelFile = await writeDesktopUpdateMetadata({
    directory: "apps/desktop/release", version, apiLevel: CLIENT_API_LEVEL, platform, arch,
  });
  process.stdout.write(`${channelFile}\n`);
}
