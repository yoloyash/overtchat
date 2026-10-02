// Serve exact candidate installers on loopback, without touching a public feed.
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { parse, stringify } from "yaml";

const [directory, portArgument = "4931", interruptArgument] = process.argv.slice(2);
assert(directory, "Usage: node serve-desktop-update-test.mjs candidate-directory [port] [--interrupt-once]");
const port = Number(portArgument);
assert(Number.isSafeInteger(port) && port > 0 && port < 65536);
assert(!interruptArgument || interruptArgument === "--interrupt-once");
const origin = `http://127.0.0.1:${port}`;
const responses = new Map();
const channels = (await readdir(directory)).filter((name) => ["stable-arm64-mac.yml", "stable-x64-mac.yml", "stable-linux.yml"].includes(name));
assert(channels.length > 0, "No candidate update metadata found");
for (const name of channels) {
  const metadata = parse(await readFile(path.join(directory, name), "utf8"));
  for (const file of metadata.files) {
    const filename = path.basename(new URL(file.url).pathname);
    const artifact = path.join(directory, filename);
    const hash = createHash("sha512");
    for await (const chunk of createReadStream(artifact)) hash.update(chunk);
    assert.equal(hash.digest("base64"), file.sha512, `Incorrect hash for ${filename}`);
    assert.equal((await stat(artifact)).size, file.size, `Incorrect size for ${filename}`);
    file.url = `${origin}/${encodeURIComponent(filename)}`;
    responses.set(`/${filename}`, { artifact, size: file.size });
  }
  metadata.path = metadata.files[0].url;
  responses.set(`/${name}`, { body: stringify(metadata) });
}
let interrupted = false;
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
  const entry = responses.get(pathname);
  if (request.method !== "GET" || !entry) return response.writeHead(404).end();
  response.setHeader("Cache-Control", "no-store");
  if (entry.body) {
    response.setHeader("Content-Type", "application/yaml");
    return response.end(entry.body);
  }
  response.setHeader("Content-Length", entry.size);
  const stream = createReadStream(entry.artifact);
  stream.on("error", () => response.destroy());
  response.on("close", () => stream.destroy());
  if (interruptArgument && !interrupted) {
    interrupted = true;
    stream.once("data", (chunk) => {
      response.write(chunk);
      response.destroy();
      stream.destroy();
      process.stdout.write(`Interrupted ${pathname}; retry will serve the full candidate.\n`);
    });
  } else stream.pipe(response);
});
server.listen(port, "127.0.0.1", () => process.stdout.write(`Candidate update feed: ${origin}\n`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
