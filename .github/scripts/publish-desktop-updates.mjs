import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parse } from "yaml";

const feeds = [
  ["stable-arm64-mac.yml", "mac", "arm64", ["zip"]],
  ["stable-x64-mac.yml", "mac", "x64", ["zip"]],
  ["stable-linux.yml", "linux", "x64", ["AppImage", "deb", "rpm"]],
];

function versionParts(version) {
  assert(typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), "Expected a stable X.Y.Z version");
  return version.split(".").map(BigInt);
}

function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

/** Validate every channel before making any public feed changes. */
export async function publishDesktopUpdates({ directory, tag, client, bucket, publicUrl, fetchImpl = globalThis.fetch }) {
  assert(typeof tag === "string" && tag.startsWith("desktop-v"), "Expected a desktop release tag");
  const version = tag.slice("desktop-v".length);
  versionParts(version);
  assert.equal(publicUrl.replace(/\/$/, ""), "https://updates.overtchat.com", "The public R2 URL must match the desktop client's feed host");
  const candidates = [];
  let apiLevel;
  for (const [filename, platform, arch, extensions] of feeds) {
    const body = await readFile(path.join(directory, filename), "utf8");
    const metadata = parse(body);
    assert.equal(metadata.version, version);
    assert(Number.isSafeInteger(metadata.clientApiLevel) && metadata.clientApiLevel > 0, "Missing clientApiLevel");
    apiLevel ??= metadata.clientApiLevel;
    assert.equal(metadata.clientApiLevel, apiLevel, "All architectures must target the same server API");
    assert.equal(metadata.files.length, extensions.length);
    for (const [index, extension] of extensions.entries()) {
      const artifact = extension === "AppImage" ? "overtchat-linux-x64.AppImage" : `overtchat-${version}-${platform}-${arch}.${extension}`;
      const file = metadata.files[index];
      assert.equal(file.url, `https://github.com/yoloyash/overtchat/releases/download/${tag}/${artifact}`);
      const bytes = await readFile(path.join(directory, artifact));
      assert.equal(file.size, bytes.length, `Incorrect size for ${artifact}`);
      assert.equal(file.sha512, createHash("sha512").update(bytes).digest("base64"), `Incorrect hash for ${artifact}`);
    }
    assert.equal(metadata.path, metadata.files[0].url);
    assert.equal(metadata.sha512, metadata.files[0].sha512);
    const key = `desktop/${filename}`;
    let current = null;
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      current = { body: await object.Body.transformToString(), etag: object.ETag };
      assert(current.etag, "Existing feed is missing its ETag");
    } catch (error) {
      if (error.name !== "NoSuchKey" && error.$metadata?.httpStatusCode !== 404) throw error;
    }
    const comparison = current ? compareVersions(version, parse(current.body).version) : 1;
    if (comparison === 0) assert.equal(body, current.body, "A published version's feed cannot be changed");
    candidates.push({ key, body, current, comparison });
  }
  const results = [];
  for (const { key, body, current, comparison } of candidates) {
    if (comparison < 0) {
      results.push(`${key}: skipped older ${version}`);
      continue;
    }
    if (comparison > 0) {
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: body,
        ContentType: "application/yaml", CacheControl: "no-store",
        ...(current ? { IfMatch: current.etag } : { IfNoneMatch: "*" }),
      }));
    }
    const response = await fetchImpl(`${publicUrl.replace(/\/$/, "")}/${key}`, { cache: "no-store" });
    assert(response.ok, `Public feed ${key} returned HTTP ${response.status}`);
    assert.equal(await response.text(), body, `Public feed ${key} does not match the published release`);
    results.push(`${key}: ${comparison === 0 ? "already published" : "published"} ${version}`);
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory, tag] = process.argv.slice(2);
  for (const name of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_R2_ACCESS_KEY_ID", "CLOUDFLARE_R2_SECRET_ACCESS_KEY", "CLOUDFLARE_R2_PUBLIC_URL", "CLOUDFLARE_R2_BUCKET"]) {
    assert(process.env[name], `Missing ${name}`);
  }
  const client = new S3Client({
    region: "auto",
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID, secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY },
  });
  const results = await publishDesktopUpdates({
    directory, tag, client, bucket: process.env.CLOUDFLARE_R2_BUCKET, publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL,
  });
  process.stdout.write(`${results.join("\n")}\n`);
}
