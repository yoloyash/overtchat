import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { test } from "node:test";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { parse, stringify } from "yaml";
import { writeDesktopUpdateMetadata } from "./desktop-update-metadata.mjs";
import { desktopReleaseIncludesWindows, publishDesktopUpdates } from "./publish-desktop-updates.mjs";

async function fixture(t, version = "0.3.1", windows = true) {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-publish-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [platform, arch, extensions] of [["mac", "arm64", ["zip"]], ["mac", "x64", ["zip"]], ["linux", "x64", ["AppImage", "deb", "rpm"]], ["windows", "x64", ["exe"]]]) {
    if (platform === "windows" && !windows) continue;
    const files = extensions.map((ext) => ({ url: ext === "AppImage" ? "overtchat-linux-x64.AppImage" : `overtchat-${version}-${platform}-${arch}.${ext}` }));
    for (const file of files) await writeFile(path.join(directory, file.url), `signed ${file.url}`);
    await writeFile(path.join(directory, platform === "windows" ? "latest.yml" : `latest-${platform}.yml`), stringify({ version, files }));
    await writeDesktopUpdateMetadata({ directory, version, apiLevel: 2, platform, arch });
  }
  const objects = new Map();
  let writes = 0;
  const client = { async send(command) {
    const { Key, Body, IfMatch, IfNoneMatch } = command.input;
    if (command instanceof GetObjectCommand) {
      if (!objects.has(Key)) throw Object.assign(new Error("absent"), { name: "NoSuchKey" });
      return { ETag: '"etag"', Body: { transformToString: async () => objects.get(Key) } };
    }
    assert(command instanceof PutObjectCommand);
    assert.equal(objects.has(Key) ? IfMatch : IfNoneMatch, objects.has(Key) ? '"etag"' : "*");
    assert.equal(command.input.CacheControl, "no-store");
    objects.set(Key, Body);
    writes++;
  } };
  const args = {
    directory, tag: `desktop-v${version}`, client, bucket: "overtchat-updates", publicUrl: "https://updates.overtchat.com",
    fetchImpl: async (url) => ({ ok: true, text: async () => objects.get(new URL(url).pathname.slice(1)) }),
  };
  return { args, objects, writes: () => writes };
}

test("publishes all four verified feeds and reruns without rewriting a release", async (t) => {
  const f = await fixture(t);
  assert.equal((await publishDesktopUpdates(f.args)).length, 4);
  assert.equal(f.writes(), 4);
  await publishDesktopUpdates(f.args);
  assert.equal(f.writes(), 4);
});

test("an old workflow cannot roll back a newer feed", async (t) => {
  const f = await fixture(t);
  await publishDesktopUpdates(f.args);
  for (const [key, body] of f.objects) f.objects.set(key, stringify({ ...parse(body), version: "0.4.0" }));
  const results = await publishDesktopUpdates(f.args);
  assert(results.every((result) => result.includes("skipped older")));
  assert.equal(f.writes(), 4);
});

test("corrupt archives fail before any channel becomes public", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.args.directory, "overtchat-0.3.1-linux-x64.rpm"), "tampered");
  await assert.rejects(publishDesktopUpdates(f.args), /Incorrect (hash|size)/);
  assert.equal(f.writes(), 0);
});

test("the same published version cannot be mutated", async (t) => {
  const f = await fixture(t);
  await publishDesktopUpdates(f.args);
  const file = path.join(f.args.directory, "stable-linux.yml");
  const body = parse(await readFile(file, "utf8"));
  body.releaseDate = "2026-10-03T00:00:00Z";
  await writeFile(file, stringify(body));
  await assert.rejects(publishDesktopUpdates(f.args), /cannot be changed/);
  assert.equal(f.writes(), 4);
});

test("permissions and concurrent-write failures are never treated as absent objects", async (t) => {
  const f = await fixture(t);
  await assert.rejects(publishDesktopUpdates({ ...f.args, client: { send: async () => { throw new Error("AccessDenied"); } } }), /AccessDenied/);
  await assert.rejects(publishDesktopUpdates({ ...f.args, client: { send: async (command) => {
    if (command instanceof GetObjectCommand) throw Object.assign(new Error("absent"), { name: "NoSuchKey" });
    throw new Error("PreconditionFailed");
  } } }), /PreconditionFailed/);
  assert.equal(f.writes(), 0);
});

test("public host and served bytes must match the client and release", async (t) => {
  const f = await fixture(t);
  await assert.rejects(publishDesktopUpdates({ ...f.args, publicUrl: "https://wrong.example" }), /feed host/);
  await assert.rejects(publishDesktopUpdates({ ...f.args, fetchImpl: async () => ({ ok: true, text: async () => "stale" }) }), /does not match/);
});

for (const artifact of ["overtchat-0.3.1-windows-x64.exe", "stable.yml"]) {
  test(`missing Windows ${artifact} prevents partial publication`, async (t) => {
    const f = await fixture(t);
    await rm(path.join(f.args.directory, artifact));
    await assert.rejects(publishDesktopUpdates(f.args), /ENOENT/);
    assert.equal(f.writes(), 0);
  });
}

test("tampered Windows installer prevents all feed writes", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.args.directory, "overtchat-0.3.1-windows-x64.exe"), "tampered");
  await assert.rejects(publishDesktopUpdates(f.args), /Incorrect (hash|size)/);
  assert.equal(f.writes(), 0);
});

for (const version of ["0.1.1", "0.2.1", "0.3.0"]) {
  test(`pre-Windows ${version} publishes three feeds and leaves Windows untouched`, async (t) => {
    const f = await fixture(t, version, false);
    f.objects.set("desktop/stable.yml", "existing Windows feed");
    assert.equal(await desktopReleaseIncludesWindows(f.args.directory, version), false);
    assert.equal((await publishDesktopUpdates(f.args)).length, 3);
    assert.equal(f.writes(), 3);
    assert.equal(f.objects.get("desktop/stable.yml"), "existing Windows feed");
    await publishDesktopUpdates(f.args);
    assert.equal(f.writes(), 3);
  });
}

test("post-0.3.0 releases cannot omit the entire Windows artifact set", async (t) => {
  const f = await fixture(t, "0.3.1", false);
  assert.equal(await desktopReleaseIncludesWindows(f.args.directory, "0.3.1"), true);
  await assert.rejects(publishDesktopUpdates(f.args), /ENOENT/);
  assert.equal(f.writes(), 0);
});

test("legacy candidates with Windows still publish all four feeds", async (t) => {
  const f = await fixture(t, "0.3.0");
  assert.equal((await publishDesktopUpdates(f.args)).length, 4);
});

for (const artifact of ["stable.yml", "desktop-checksums-windows-x64.txt", "overtchat-0.3.0-windows-x64.exe"]) {
  test(`a lone legacy Windows ${artifact} cannot bypass validation`, async (t) => {
    const f = await fixture(t, "0.3.0", false);
    await writeFile(path.join(f.args.directory, artifact), "incomplete");
    assert.equal(await desktopReleaseIncludesWindows(f.args.directory, "0.3.0"), true);
    await assert.rejects(publishDesktopUpdates(f.args));
    assert.equal(f.writes(), 0);
  });
}
