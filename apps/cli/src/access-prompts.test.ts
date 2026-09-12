import { beforeEach, describe, expect, it, vi } from "vitest";
import { promptAccess } from "./access-prompts.js";
import { checkServeRoute, detectTailscale } from "./tailscale.js";
import { note, select, text } from "@clack/prompts";
import type { InstallationConfig } from "./types.js";

const answers = vi.hoisted(() => new Map<string, unknown[]>());
vi.mock("@clack/prompts", () => {
  const answer = vi.fn(
    async (prompt: { message: string; initialValue?: unknown }) =>
      answers.get(prompt.message)?.shift() ?? prompt.initialValue,
  );
  return {
    cancel: vi.fn(),
    isCancel: () => false,
    note: vi.fn(),
    select: answer,
    text: answer,
    confirm: answer,
  };
});
vi.mock("./network.js", () => ({ primaryLanAddress: () => "192.168.1.20" }));
vi.mock("./tailscale.js", () => ({
  checkServeRoute: vi.fn(),
  detectTailscale: vi.fn(),
}));
const config = {
  appPort: 4718,
  publicUrl: "http://192.168.1.20:4718",
  bindAddress: "0.0.0.0",
  connectorServerUrl: "http://127.0.0.1:4718",
  extraTrustedOrigins: [],
  composeProject: "overtchat",
} as unknown as InstallationConfig;
function answer(message: string, ...values: unknown[]) {
  answers.set(message, values);
}
beforeEach(() => {
  answers.clear();
  vi.clearAllMocks();
  vi.mocked(checkServeRoute).mockResolvedValue();
});

describe("access wizard", () => {
  it("restricts local access and removes addresses from the previous mode", async () => {
    answer("Where do you want to access OvertChat?", "local");
    const selected = await promptAccess({
      ...config,
      extraTrustedOrigins: ["https://old.example.com"],
    });
    expect(selected).toMatchObject({
      bindAddress: "127.0.0.1",
      publicUrl: "http://localhost:4718",
      extraTrustedOrigins: [],
      access: { mode: "local" },
    });
  });
  it("detects a LAN address for a new installation and updates the port consistently", async () => {
    answer("Where do you want to access OvertChat?", "lan");
    answer("Customize the port or additional addresses?", true);
    answer("OvertChat port", "4999");
    answer(
      "Additional addresses (comma-separated, optional)",
      "http://my-server:4999",
    );
    const selected = await promptAccess({
      ...config,
      publicUrl: "http://localhost:4718",
    });
    expect(selected).toMatchObject({
      bindAddress: "0.0.0.0",
      appPort: 4999,
      publicUrl: "http://192.168.1.20:4999",
      connectorServerUrl: "http://127.0.0.1:4999",
      extraTrustedOrigins: ["http://my-server:4999"],
    });
  });
  it("preselects saved access choices and preserves additional addresses", async () => {
    const selected = await promptAccess({
      ...config,
      extraTrustedOrigins: ["http://my-server:4718"],
      access: { mode: "lan" },
    });
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Where do you want to access OvertChat?",
        initialValue: "lan",
      }),
    );
    expect(selected.extraTrustedOrigins).toEqual(["http://my-server:4718"]);
  });
  it("lets users return to other options when Tailscale is missing", async () => {
    answer("Where do you want to access OvertChat?", "tailscale", "local");
    answer("Continue Tailscale setup?", false);
    vi.mocked(detectTailscale).mockResolvedValue({
      problem: "Tailscale not found.",
    });
    expect((await promptAccess(config)).access?.mode).toBe("local");
    expect(note).toHaveBeenCalledWith(
      "Tailscale not found.",
      "Tailscale setup",
    );
    expect(checkServeRoute).not.toHaveBeenCalled();
  });
  it("retries sign-in and chooses another port when another app uses Serve", async () => {
    answer("Where do you want to access OvertChat?", "tailscale");
    answer("Continue Tailscale setup?", true);
    answer("Continue with Tailscale Serve?", "port");
    vi.mocked(detectTailscale)
      .mockResolvedValueOnce({ problem: "Sign in first." })
      .mockResolvedValueOnce({ hostname: "server.example.ts.net" });
    vi.mocked(checkServeRoute)
      .mockRejectedValueOnce(new Error("Port in use."))
      .mockResolvedValueOnce();
    const selected = await promptAccess(config);
    expect(selected).toMatchObject({
      bindAddress: "127.0.0.1",
      publicUrl: "https://server.example.ts.net:8443",
      access: {
        mode: "tailscale",
        connectionStatus: "pending",
        tailscaleRoute: {
          hostname: "server.example.ts.net",
          port: 8443,
          target: "http://127.0.0.1:4718",
        },
      },
    });
    expect(detectTailscale).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["host", "127.0.0.1", "http://127.0.0.1:4718"],
    ["docker", "127.0.0.1", "http://app:4717"],
    ["remote", "0.0.0.0", "LAN IP"],
  ])(
    "configures Cloudflare running in %s",
    async (location, binding, target) => {
      answer("Where do you want to access OvertChat?", "advanced");
      answer("What address will you use?", "https://chat.example.com/");
      answer("Where does your tunnel or proxy run?", location);
      const selected = await promptAccess(config);
      expect(selected).toMatchObject({
        bindAddress: binding,
        publicUrl: "https://chat.example.com",
        access: {
          mode: "advanced",
          proxy: "cloudflare",
          proxyLocation: location,
          connectionStatus: "pending",
        },
      });
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining(target),
        "Connect your address",
      );
      expect(text).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "What address will you use?",
          validate: expect.any(Function),
        }),
      );
    },
  );
});
