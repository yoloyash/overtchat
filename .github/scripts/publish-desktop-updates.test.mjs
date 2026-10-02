import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { test } from "node:test";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { parse, stringify } from "yaml";
import { writeDesktopUpdateMetadata } from "./desktop-update-metadata.mjs";
import { publishDesktopUpdates } from "./publish-desktop-updates.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-publish-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [platform, arch, extensions] of [["mac", "arm64", ["zip"]], ["mac", "x64", ["zip"]], ["linux", "x64", ["AppImage", "deb", "rpm"]]]) {
    const files = extensions.map((ext) => ({ url: ext === "AppImage" ? "overtchat-linux-x64.AppImage" : `overtchat-0.1.1-${platform}-${arch}.${ext}` }));
    for (const file of files) await writeFile(path.join(directory, file.url), `signed ${file.url}`);
    await writeFile(path.join(directory, `latest-${platform}.yml`), stringify({ version: "0.1.1", files }));
    await writeDesktopUpdateMetadata({ directory, version: "0.1.1", apiLevel: 2, platform, arch });
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
    directory, tag: "desktop-v0.1.1", client, bucket: "overtchat-updates", publicUrl: "https://updates.overtchat.com",
    fetchImpl: async (url) => ({ ok: true, text: async () => objects.get(new URL(url).pathname.slice(1)) }),
  };
  return { args, objects, writes: () => writes };
}

test("publishes all three verified feeds and reruns without rewriting a release", async (t) => {
  const f = await fixture(t);
  assert.equal((await publishDesktopUpdates(f.args)).length, 3);
  assert.equal(f.writes(), 3);
  await publishDesktopUpdates(f.args);
  assert.equal(f.writes(), 3);
});

test("an old workflow cannot roll back a newer feed", async (t) => {
  const f = await fixture(t);
  await publishDesktopUpdates(f.args);
  for (const [key, body] of f.objects) f.objects.set(key, stringify({ ...parse(body), version: "0.2.0" }));
  const results = await publishDesktopUpdates(f.args);
  assert(results.every((result) => result.includes("skipped older")));
  assert.equal(f.writes(), 3);
});

test("corrupt archives fail before any channel becomes public", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.args.directory, "overtchat-0.1.1-linux-x64.rpm"), "tampered");
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
  assert.equal(f.writes(), 3);
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
