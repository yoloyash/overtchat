import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  accessMode,
  accessSummary,
  additionalAddressValidation,
  addressValidation,
  connectionInstructions,
  portValidation,
} from "./access.js";
import type { InstallationConfig } from "./types.js";

const config = {
  appPort: 4718,
  publicUrl: "http://192.168.1.20:4718",
  bindAddress: "0.0.0.0",
  composeProject: "overtchat",
} as InstallationConfig;

describe("access configuration", () => {
  it("infers existing installations without requiring a state migration", () => {
    expect(accessMode(config)).toBe("lan");
    expect(
      accessMode({
        ...config,
        bindAddress: "127.0.0.1",
        publicUrl: "http://localhost:4718",
      }),
    ).toBe("local");
    expect(
      accessMode({ ...config, publicUrl: "https://chat.example.com" }),
    ).toBe("advanced");
    expect(accessMode({ ...config, access: { mode: "tailscale" } })).toBe(
      "tailscale",
    );
  });
  it.each([
    "https://user:pass@example.com",
    "https://example.com/chat",
    "https://example.com?q=1",
    "https://example.com#chat",
    "ftp://example.com",
    "http://0.0.0.0:4718",
  ])("rejects an unusable browser address %s", (value) => {
    expect(addressValidation(value)).toBeTruthy();
  });
  it("validates HTTPS and additional addresses without opening arbitrary origins", () => {
    expect(addressValidation("https://chat.example.com/")).toBeUndefined();
    expect(addressValidation("http://chat.example.com", true)).toBeTruthy();
    expect(
      additionalAddressValidation(
        "http://192.168.1.20:4718",
        "https://chat.example.com",
      ),
    ).toBeTruthy();
    expect(
      additionalAddressValidation(
        "https://other.example.com",
        "https://chat.example.com",
      ),
    ).toBeUndefined();
  });
  it.each(["0", "65536", "1.5", "-1", "4718x", ""])(
    "rejects invalid port %s",
    (value) => expect(portValidation(value)).toBeTruthy(),
  );
  it("describes the correct proxy destination for each placement", () => {
    const advanced = {
      ...config,
      publicUrl: "https://chat.example.com",
      access: { mode: "advanced", proxy: "cloudflare" },
    } as InstallationConfig;
    expect(
      connectionInstructions({
        ...advanced,
        access: { ...advanced.access!, proxyLocation: "host" },
      }),
    ).toContain("Service: http://127.0.0.1:4718");
    const docker = connectionInstructions({
      ...advanced,
      access: { ...advanced.access!, proxyLocation: "docker" },
    });
    expect(docker).toContain("Service: http://app:4717");
    expect(docker).toContain("overtchat_default");
    expect(
      connectionInstructions({
        ...advanced,
        access: { ...advanced.access!, proxyLocation: "remote" },
      }),
    ).toContain("http://<this server's LAN IP>:4718");
    expect(
      connectionInstructions({
        ...advanced,
        access: { ...advanced.access!, proxy: "other" },
      }),
    ).toContain("WebSocket upgrades");
  });
  it("does not advertise a pending public address as ready", () => {
    expect(
      accessSummary({
        ...config,
        access: { mode: "advanced", connectionStatus: "pending" },
      }),
    ).toContain("Connection pending:");
    expect(accessSummary(config)).toContain(
      "This computer: http://localhost:4718",
    );
  });
  it("passes source Compose address settings into the published port and auth environment", async () => {
    const compose = await readFile(
      new URL("../../../compose.yml", import.meta.url),
      "utf8",
    );
    expect(compose).toContain(
      "${APP_BIND_ADDRESS:-0.0.0.0}:${APP_PORT:-4718}:4717",
    );
    expect(compose).toContain(
      "EXTRA_TRUSTED_ORIGINS: ${EXTRA_TRUSTED_ORIGINS:-}",
    );
  });
});
