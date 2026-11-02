import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIENT_API_LEVEL } from "@overtchat/shared";
import { probeServer, serverOrigin } from "./server-probe";

test("public hostnames default to HTTPS while explicit schemes and local HTTP addresses work", () => {
  for (const [address, origin] of [
    [" chat.example.com ", "https://chat.example.com"],
    ["chat.example.com:8443/path", "https://chat.example.com:8443"],
    ["chat.example.com:80", "https://chat.example.com:80"],
    ["http://chat.example.com", "http://chat.example.com"],
    ["https://localhost:4718", "https://localhost:4718"],
    ["localhost:4717", "http://localhost:4717"],
    ["localhost:443", "http://localhost:443"],
    ["gaming-pc:4718", "http://gaming-pc:4718"],
    ["server.local:4718", "http://server.local:4718"],
    ["server.lan", "http://server.lan"],
    ["server.home.arpa", "http://server.home.arpa"],
    ["192.168.1.10:4718", "http://192.168.1.10:4718"],
    ["[::1]:4718", "http://[::1]:4718"],
    ["[fd00::1]:4718", "http://[fd00::1]:4718"],
  ]) assert.equal(serverOrigin(address), origin, address);
  for (const address of ["", " ", "ssh gaming-pc", "ssh://gaming-pc", "https://user:password@example.com", "http://", "localhost:99999"]) {
    assert.equal(serverOrigin(address), null, address);
  }
});

function pingResponse(url: string, apiLevel = CLIENT_API_LEVEL) {
  const response = Response.json({ name: "overtchat", version: "test", apiLevel });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

test("the probe returns the final HTTPS origin for a same-host upgrade, including compatibility", async () => {
  for (const apiLevel of [CLIENT_API_LEVEL - 1, CLIENT_API_LEVEL, CLIENT_API_LEVEL + 1]) {
    const result = await probeServer("http://chat.example.com", async (url) => {
      assert.equal(url, "http://chat.example.com/api/ping");
      return pingResponse("https://chat.example.com/api/ping", apiLevel);
    });
    assert(result.ok);
    assert.equal(result.origin, "https://chat.example.com");
    assert.equal(result.apiLevel, apiLevel);
    assert.equal(result.problem?.kind ?? null, apiLevel === CLIENT_API_LEVEL ? null
      : apiLevel < CLIENT_API_LEVEL ? "server-outdated" : "app-outdated");
  }
});

test("a direct local server keeps its HTTP origin", async () => {
  const origin = "http://localhost:4718";
  const result = await probeServer(origin, async () => pingResponse(`${origin}/api/ping`));
  assert(result.ok);
  assert.equal(result.origin, origin);
});

test("redirects cannot silently change hosts, downgrade HTTPS, or select a path-mounted server", async () => {
  for (const [origin, destination] of [
    ["http://chat.example.com", "https://other.example.com/api/ping"],
    ["https://chat.example.com", "http://chat.example.com/api/ping"],
    ["https://chat.example.com", "https://chat.example.com:8443/api/ping"],
    ["http://chat.example.com", "https://chat.example.com/chat/api/ping"],
    ["http://chat.example.com", "https://chat.example.com/api/ping?tenant=other"],
    ["http://chat.example.com", "https://user:password@chat.example.com/api/ping"],
  ]) {
    const result = await probeServer(origin, async () => pingResponse(destination));
    assert(!result.ok, destination);
    assert.match(result.message, /Enter the server's final URL directly/);
  }
});
