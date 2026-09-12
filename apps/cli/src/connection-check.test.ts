import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishAccess, verifyConnection } from "./connection-check.js";
import { startServe } from "./tailscale.js";
import { select } from "@clack/prompts";
import type { InstallationConfig } from "./types.js";
vi.mock("./tailscale.js", () => ({ startServe: vi.fn() }));
vi.mock("@clack/prompts", () => ({
  note: vi.fn(),
  isCancel: () => false,
  select: vi.fn(),
}));
const instanceId = "a2ad863a-c435-48a3-bd73-4f0f16b30c76";
let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});
beforeEach(() => vi.resetAllMocks());
async function serve(): Promise<string> {
  server = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        name: "overtchat",
        instanceId: process.env.OVERTCHAT_INSTANCE_ID,
      }),
    );
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server address");
  return `http://127.0.0.1:${address.port}`;
}
describe("connection verification", () => {
  it("verifies a real HTTP ping response and rejects a different instance", async () => {
    vi.stubEnv("OVERTCHAT_INSTANCE_ID", instanceId);
    const url = await serve();
    expect(await verifyConnection(url, instanceId)).toBeNull();
    expect(await verifyConnection(url, "b".repeat(64))).toContain(
      "did not identify this",
    );
  });
  it("does not follow gateway redirects or send credentials to the configured address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://elsewhere.example" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await verifyConnection("https://chat.example.com", instanceId),
    ).toContain("HTTP 302");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(instanceId);
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("headers");
  });
  it("rejects older servers and non-OvertChat responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ok: true, name: "overtchat" })),
    );
    expect(
      await verifyConnection("https://chat.example.com", instanceId),
    ).toContain("did not identify");
  });
  it("reports network errors as pending", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("DNS failed")));
    expect(
      await verifyConnection("https://chat.example.com", instanceId),
    ).toContain("DNS");
  });
});
describe("finishing setup", () => {
  it("allows deferring an external tunnel and leaves the installation pending", async () => {
    vi.mocked(select).mockResolvedValue("later");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const config = {
      publicUrl: "https://chat.example.com",
      access: { mode: "advanced" },
    } as InstallationConfig;
    await finishAccess(config, true);
    expect(config.access?.connectionStatus).toBe("pending");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retries Serve failures then verifies the actual app", async () => {
    vi.stubEnv("OVERTCHAT_INSTANCE_ID", instanceId);
    const url = await serve();
    const route = {
      hostname: "server.example.ts.net",
      port: 443,
      target: "http://127.0.0.1:4718",
    };
    const config = {
      publicUrl: url,
      instanceId,
      access: { mode: "tailscale", tailscaleRoute: route },
    } as InstallationConfig;
    vi.mocked(startServe)
      .mockRejectedValueOnce(new Error("Enable HTTPS"))
      .mockResolvedValueOnce();
    vi.mocked(select).mockResolvedValue("retry");
    await finishAccess(config, true);
    expect(startServe).toHaveBeenCalledTimes(2);
    expect(config.access?.connectionStatus).toBe("verified");
  });
});
