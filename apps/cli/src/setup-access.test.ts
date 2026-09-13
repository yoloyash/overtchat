import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup } from "./setup.js";
import {
  defaultInstallationConfig,
  readInstallationConfig,
  writeInstallationConfig,
} from "./config.js";
import { runtimePaths } from "./paths.js";
import { parseReleaseManifest } from "./release.js";
import { promptInstallationConfig } from "./prompts.js";
import { checkServeRoute, removeServe } from "./tailscale.js";
import { finishAccess } from "./connection-check.js";
import { requireDocker } from "./docker.js";
import type { InstallationConfig } from "./types.js";

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  isCancel: () => false,
  note: vi.fn(),
  outro: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
}));
vi.mock("./prompts.js", () => ({
  promptInstallationConfig: vi.fn(),
  kokoroGpuVariant: () => "standard",
}));
vi.mock("./network.js", () => ({ primaryLanAddress: () => "192.168.1.20" }));
vi.mock("./tailscale.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tailscale.js")>()),
  checkServeRoute: vi.fn(),
  removeServe: vi.fn(),
}));
vi.mock("./connection-check.js", () => ({ finishAccess: vi.fn() }));
vi.mock("./docker.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./docker.js")>()),
  detectDockerCommand: async () => "docker",
  detectExistingInstallation: async () => null,
  detectNvidiaGpus: async () => [],
  dockerComposeAvailable: async () => true,
  reconcileManagedSidecars: async () => ({ removed: [], warnings: [] }),
  requireDocker: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  runDocker: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
}));
let directory: string;
const ttyDescriptors = [process.stdin, process.stdout].map((stream) =>
  Object.getOwnPropertyDescriptor(stream, "isTTY"),
);
const manifest = parseReleaseManifest(
  JSON.parse(
    await readFile(
      new URL("../../site/public/install-manifest.json", import.meta.url),
      "utf8",
    ),
  ),
);
const route = {
  hostname: "server.example.ts.net",
  port: 443,
  target: "http://127.0.0.1:4718",
};
const options = { dryRun: false, defaults: false, development: false };
function local(initial: InstallationConfig): InstallationConfig {
  return {
    ...initial,
    bindAddress: "127.0.0.1",
    publicUrl: "http://localhost:4718",
    access: { mode: "local" },
    search: { provider: "disabled", bundledInstalled: false },
    tts: { provider: "disabled", bundledInstalled: false },
    stt: { provider: "disabled", bundledInstalled: false },
    agents: { installed: false },
    voice: { installed: false },
  };
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(removeServe).mockResolvedValue();
  vi.mocked(checkServeRoute).mockResolvedValue();
  vi.mocked(requireDocker)
    .mockReset()
    .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-access-flow-"));
  vi.stubEnv("OVERTCHAT_HOME", directory);
  vi.stubEnv("OVERTCHAT_CONFIG_DIR", path.join(directory, "config"));
  vi.stubEnv("OVERTCHAT_STACK_DIR", path.join(directory, "stack"));
  for (const stream of [process.stdin, process.stdout])
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ capabilities: [], ok: true, name: "overtchat" }),
    ),
  );
  vi.mocked(promptInstallationConfig).mockImplementation(async (initial) =>
    local(initial),
  );
});
afterEach(async () => {
  [process.stdin, process.stdout].forEach((stream, index) => {
    const descriptor = ttyDescriptors[index];
    if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
    else Reflect.deleteProperty(stream, "isTTY");
  });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
async function savedTailscale() {
  const config = {
    ...local(defaultInstallationConfig(null, manifest)),
    publicUrl: "https://server.example.ts.net",
    access: {
      mode: "tailscale",
      tailscaleRoute: route,
      connectionStatus: "verified",
    },
    managedTailscaleRoute: route,
  } as InstallationConfig;
  await writeInstallationConfig(runtimePaths(), config);
  return config;
}
describe("access provisioning lifecycle", () => {
  it("restores the previous port and retains the old route when Docker cannot start the new binding", async () => {
    const previous = await savedTailscale();
    vi.mocked(promptInstallationConfig).mockResolvedValue({
      ...previous,
      appPort: 4999,
      access: {
        ...previous.access!,
        tailscaleRoute: { ...route, target: "http://127.0.0.1:4999" },
      },
    });
    let starts = 0;
    vi.mocked(requireDocker).mockImplementation(async (_docker, args) => {
      if (args.includes("up") && ++starts === 1)
        throw new Error("Port 4999 is already allocated");
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    await expect(setup(options, manifest)).rejects.toThrow(
      "Previous access settings restored",
    );
    expect(starts).toBe(2);
    expect(removeServe).not.toHaveBeenCalled();
    expect(finishAccess).not.toHaveBeenCalled();
    expect(await readInstallationConfig(runtimePaths())).toMatchObject({
      appPort: 4718,
      publicUrl: previous.publicUrl,
      managedTailscaleRoute: route,
    });
    expect(await readFile(runtimePaths().secretsFile, "utf8")).toContain(
      'APP_PORT="4718"',
    );
  });

  it("reports recovery failure without claiming the old access works", async () => {
    await savedTailscale();
    vi.mocked(requireDocker).mockImplementation(async (_docker, args) => {
      if (args.includes("up")) throw new Error("Docker unavailable");
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    await expect(setup(options, manifest)).rejects.toThrow(
      "Could not restore the previous access settings",
    );
    expect(removeServe).not.toHaveBeenCalled();
  });

  it("uses the shared wizard for both first installation and reconfiguration", async () => {
    await setup(options, manifest);
    expect(promptInstallationConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        access: { mode: "lan" },
        publicUrl: "http://192.168.1.20:4718",
      }),
      [],
      undefined,
    );
    expect(await readInstallationConfig(runtimePaths())).toMatchObject({
      access: { mode: "local" },
      bindAddress: "127.0.0.1",
    });
    await setup(options, manifest);
    expect(promptInstallationConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ access: { mode: "local" } }),
      [],
      undefined,
    );
    const environment = await readFile(runtimePaths().secretsFile, "utf8");
    expect(environment).toContain('APP_BIND_ADDRESS="127.0.0.1"');
    expect(environment).toContain('BETTER_AUTH_URL="http://localhost:4718"');
  });
  it("removes the old Serve route only after the replacement stack starts", async () => {
    await savedTailscale();
    await setup(options, manifest);
    expect(removeServe).toHaveBeenCalledWith(route);
    const upIndex = vi
      .mocked(requireDocker)
      .mock.calls.findIndex(([, args]) => args.includes("up"));
    expect(vi.mocked(removeServe).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(requireDocker).mock.invocationCallOrder[upIndex]!,
    );
    const saved = await readInstallationConfig(runtimePaths());
    expect(saved?.access?.mode).toBe("local");
    expect(saved?.managedTailscaleRoute).toBeUndefined();
  });
  it("retains old ownership during a dry run and cleans it up on the actual run", async () => {
    await savedTailscale();
    await setup({ ...options, dryRun: true }, manifest);
    expect(removeServe).not.toHaveBeenCalled();
    expect(finishAccess).not.toHaveBeenCalled();
    expect(await readInstallationConfig(runtimePaths())).toMatchObject({
      access: { mode: "tailscale" },
      managedTailscaleRoute: route,
    });
    await setup(options, manifest);
    expect(removeServe).toHaveBeenCalledWith(route);
    expect(
      (await readInstallationConfig(runtimePaths()))?.managedTailscaleRoute,
    ).toBeUndefined();
  });
  it("records ownership before starting Serve so an interrupted setup is recoverable", async () => {
    vi.mocked(promptInstallationConfig).mockImplementation(async (initial) => ({
      ...local(initial),
      publicUrl: "https://server.example.ts.net",
      access: {
        mode: "tailscale",
        tailscaleRoute: route,
        connectionStatus: "pending",
      },
    }));
    vi.mocked(finishAccess).mockImplementationOnce(async () => {
      expect(
        (await readInstallationConfig(runtimePaths()))?.managedTailscaleRoute,
      ).toEqual(route);
    });
    await setup(options, manifest);
    expect(checkServeRoute).toHaveBeenCalledWith(route, undefined);
  });
  it("retains route ownership when cleanup fails after starting the stack", async () => {
    await savedTailscale();
    vi.mocked(removeServe).mockRejectedValueOnce(
      new Error("Route changed outside setup"),
    );
    await expect(setup(options, manifest)).rejects.toThrow(
      "Route changed outside setup",
    );
    expect(
      vi
        .mocked(requireDocker)
        .mock.calls.some(([, args]) => args.includes("up")),
    ).toBe(true);
    expect(
      (await readInstallationConfig(runtimePaths()))?.managedTailscaleRoute,
    ).toEqual(route);
  });
});
