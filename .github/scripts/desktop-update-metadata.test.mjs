import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { writeDesktopUpdateMetadata } from "./desktop-update-metadata.mjs";

for (const [platform, arch, extensions, channel] of [
  ["mac", "arm64", ["zip"], "stable-arm64-mac.yml"],
  ["mac", "x64", ["zip"], "stable-x64-mac.yml"],
  ["linux", "x64", ["AppImage", "deb", "rpm"], "stable-linux.yml"],
]) {
  test(`metadata pins ${platform} ${arch} archives and hashes the final bytes`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "desktop-metadata-"));
    try {
      const files = [];
      for (const extension of extensions) {
        const url = extension === "AppImage" ? "overtchat-linux-x64.AppImage" : `overtchat-0.1.1-${platform}-${arch}.${extension}`;
        files.push({ url, sha512: "outdated hash" });
        await writeFile(path.join(directory, url), `final bytes for ${extension}`);
      }
      await writeFile(path.join(directory, `latest-${platform}.yml`), stringify({ version: "0.1.1", files, releaseDate: "2026-10-02T00:00:00Z" }));
      assert.equal(await writeDesktopUpdateMetadata({ directory, version: "0.1.1", apiLevel: 1, platform, arch }), channel);
      const metadata = parse(await readFile(path.join(directory, channel), "utf8"));
      assert.equal(metadata.clientApiLevel, 1);
      assert.equal(metadata.files.length, extensions.length);
      for (const [index, extension] of extensions.entries()) {
        assert.equal(metadata.files[index].sha512, createHash("sha512").update(`final bytes for ${extension}`).digest("base64"));
        assert.equal(metadata.files[index].url, `https://github.com/yoloyash/overtchat/releases/download/desktop-v0.1.1/${files[index].url}`);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
