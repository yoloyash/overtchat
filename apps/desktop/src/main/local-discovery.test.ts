import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { CLIENT_API_LEVEL } from "@overtchat/shared";
import { discoverLocalServers, localServerOrigins } from "./local-discovery";
import { probeServer, type PingResult } from "./server-probe";

const unavailable: PingResult = { ok: false, message: "Unavailable" };

async function installation(t: TestContext, contents?: unknown) {
  const directory = await mkdtemp(path.join(tmpdir(), "overtchat-discovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  if (contents !== undefined) {
    await writeFile(path.join(directory, "installation.json"), JSON.stringify(contents));
  }
  return { OVERTCHAT_CONFIG_DIR: directory };
}

test("default/source ports work without installation state; custom ports are deduplicated", async (t) => {
  const environment = await installation(t);
  assert.deepEqual(await localServerOrigins(environment), ["http://localhost:4718", "http://localhost:4717"]);
  for (const port of [49317, 4718]) {
    await writeFile(path.join(environment.OVERTCHAT_CONFIG_DIR, "installation.json"), JSON.stringify({ format: 1, appPort: port }));
    assert.deepEqual(await localServerOrigins(environment), port === 4718
      ? ["http://localhost:4718", "http://localhost:4717"]
      : ["http://localhost:4718", "http://localhost:4717", "http://localhost:49317"]);
  }
});

test("manager home override is supported and config directory takes precedence", async (t) => {
  const environment = await installation(t);
  const directory = path.join(environment.OVERTCHAT_CONFIG_DIR, ".config", "overtchat");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "installation.json"), JSON.stringify({ format: 1, appPort: 49317 }));
  assert((await localServerOrigins({ OVERTCHAT_HOME: environment.OVERTCHAT_CONFIG_DIR })).includes("http://localhost:49317"));
  assert.equal((await localServerOrigins({ ...environment, OVERTCHAT_HOME: environment.OVERTCHAT_CONFIG_DIR })).length, 2);
});

test("invalid state is ignored and public URLs never become discovery targets", async (t) => {
  const environment = await installation(t);
  for (const config of [null, [], { format: 2, appPort: 49317 },
    ...[0, -1, 65_536, 4718.5, "49317", null].map((appPort) => ({ format: 1, appPort, publicUrl: "https://example.invalid" }))]) {
    await writeFile(path.join(environment.OVERTCHAT_CONFIG_DIR, "installation.json"), JSON.stringify(config));
    assert.equal((await localServerOrigins(environment)).length, 2);
  }
  await writeFile(path.join(environment.OVERTCHAT_CONFIG_DIR, "installation.json"), "{broken");
  assert.equal((await localServerOrigins(environment)).length, 2);
});

test("probes start concurrently, tolerate failures, and retain compatibility information", async (t) => {
  const environment = await installation(t, { format: 1, appPort: 49317 });
  const started: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const discovery = discoverLocalServers(async (origin, options) => {
    assert.deepEqual(options, { timeoutMs: 1_500, redirect: "error" });
    started.push(origin);
    if (started.length === 3) release();
    await barrier;
    if (origin.endsWith(":4718")) return unavailable;
    if (origin.endsWith(":4717")) throw new Error("Network unavailable");
    return { ok: true, version: "old", apiLevel: 0, problem: { kind: "server-outdated", version: "old" } };
  }, environment);
  assert.deepEqual(await discovery, [{ origin: "http://localhost:49317", version: "old", problem: { kind: "server-outdated", version: "old" } }]);
  assert.equal(started.length, 3);
});

test("real HTTP discovery validates identity/API level, rejects redirects, and times out stalled bodies", async (t) => {
  let body: unknown = { ok: true, name: "overtchat", version: "test", apiLevel: CLIENT_API_LEVEL };
  let mode: "json" | "redirect" | "invalid" | "stall" = "json";
  let redirected = 0;
  const server = createServer((request, response) => {
    if (request.url === "/redirected") redirected++;
    if (mode === "redirect") return response.writeHead(302, { Location: "/redirected" }).end();
    if (mode === "stall") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"name":');
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(mode === "invalid" ? "<html>Other app</html>" : JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const port = (server.address() as { port: number }).port;
  const environment = await installation(t, { format: 1, appPort: port });
  const origin = `http://localhost:${port}`;
  const discover = () => discoverLocalServers((candidate, options) => candidate === origin
    ? probeServer(candidate, fetch, options)
    : Promise.resolve(unavailable), environment);
  assert.deepEqual(await discover(), [{ origin, version: "test", problem: null }]);
  body = { name: "other-app", apiLevel: CLIENT_API_LEVEL };
  assert.deepEqual(await discover(), []);
  body = { name: "overtchat", version: "legacy" };
  assert.deepEqual((await discover())[0].problem, { kind: "server-outdated", version: "legacy" });
  body = { name: "overtchat", version: "future", apiLevel: CLIENT_API_LEVEL + 1 };
  assert.deepEqual((await discover())[0].problem, { kind: "app-outdated", version: "future" });
  mode = "invalid";
  assert.deepEqual(await discover(), []);
  mode = "redirect";
  assert.deepEqual(await discover(), []);
  assert.equal(redirected, 0);
  mode = "stall";
  assert.deepEqual(await discover(), []);
});
