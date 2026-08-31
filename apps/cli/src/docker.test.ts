import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallationConfig } from "./types.js";

const mocks = vi.hoisted(() => ({
  commandExists: vi.fn(),
  requireSuccessful: vi.fn(),
  runCommand: vi.fn(),
}));

vi.mock("./process.js", () => ({
  commandExists: mocks.commandExists,
  requireSuccessful: mocks.requireSuccessful,
  runCommand: mocks.runCommand,
}));

import { parseNvidiaSmi, reconcileManagedSidecars } from "./docker.js";

function config(
  overrides: Partial<InstallationConfig> = {},
): InstallationConfig {
  return {
    format: 1,
    appVersion: "0.14.0",
    appImage: "ghcr.io/yoloyash/overtchat-app:0.14.0",
    voiceVersion: "0.1.0",
    voiceImage: "ghcr.io/yoloyash/overtchat-voice:0.1.0",
    connectorVersion: "0.4.0",
    sttVersion: "0.1.0",
    redisImage: `docker.io/library/redis@sha256:${"a".repeat(64)}`,
    searxngImage: `docker.io/searxng/searxng@sha256:${"b".repeat(64)}`,
    kokoroImage: `ghcr.io/remsky/kokoro-fastapi-cpu@sha256:${"c".repeat(64)}`,
    appPort: 4718,
    bindAddress: "127.0.0.1",
    publicUrl: "https://chat.example.com",
    extraTrustedOrigins: [],
    connectorServerUrl: "http://127.0.0.1:4718",
    composeProject: "overtchat",
    dataMountType: "volume",
    dataVolume: "overtchat-data",
    search: { provider: "bundled", bundledInstalled: true },
    tts: { provider: "bundled", bundledInstalled: true },
    stt: {
      provider: "bundled",
      bundledInstalled: true,
      accelerator: "cpu",
    },
    voice: { installed: false },
    agents: { installed: false },
    ...overrides,
  };
}

function inspectedContainer(
  name: string,
  service: string,
  project = "overtchat",
): string {
  return JSON.stringify([
    {
      Name: `/${name}`,
      Config: {
        Labels: {
          "com.docker.compose.project": project,
          "com.docker.compose.service": service,
        },
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NVIDIA GPU discovery", () => {
  it("keeps stable UUIDs alongside the friendly index and memory", () => {
    expect(
      parseNvidiaSmi(
        "0, GPU-4090, NVIDIA GeForce RTX 4090, 24564\n1, GPU-A4000, NVIDIA RTX A4000, 16376\n",
      ),
    ).toEqual([
      {
        index: 0,
        uuid: "GPU-4090",
        name: "NVIDIA GeForce RTX 4090",
        memoryMiB: 24_564,
      },
      {
        index: 1,
        uuid: "GPU-A4000",
        name: "NVIDIA RTX A4000",
        memoryMiB: 16_376,
      },
    ]);
  });

  it("ignores malformed rows rather than offering broken devices", () => {
    expect(parseNvidiaSmi("not,a,gpu,row\n2, GPU-ok, RTX 6000, 49140"))
      .toEqual([
        {
          index: 2,
          uuid: "GPU-ok",
          name: "RTX 6000",
          memoryMiB: 49_140,
        },
      ]);
  });
});

describe("managed sidecar reconciliation", () => {
  it("removes only inactive-profile containers owned by this Compose project", async () => {
    mocks.runCommand.mockImplementation(
      async (_command: string, args: string[]) => {
        const name = args[1];
        if (args[0] === "inspect" && name === "overtchat-searxng") {
          return {
            stdout: inspectedContainer(name, "searxng"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (args[0] === "inspect") {
          return { stdout: "", stderr: "No such container", exitCode: 1 };
        }
        return { stdout: name ?? "", stderr: "", exitCode: 0 };
      },
    );

    const result = await reconcileManagedSidecars(
      { command: "docker", prefix: [] },
      config({
        search: {
          provider: "searxng",
          bundledInstalled: false,
          baseUrl: "http://host.docker.internal:8088",
        },
      }),
    );

    expect(result).toEqual({ removed: ["SearXNG"], warnings: [] });
    expect(mocks.runCommand).toHaveBeenCalledWith(
      "docker",
      ["container", "rm", "--force", "overtchat-searxng"],
      {},
    );
    expect(mocks.runCommand).not.toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["--volumes"]),
      expect.anything(),
    );
    expect(mocks.runCommand).not.toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["overtchat-kokoro"]),
      expect.anything(),
    );
    expect(mocks.runCommand).not.toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["overtchat-stt-cpu"]),
      expect.anything(),
    );
  });

  it("removes the old CPU container when managed STT moves to NVIDIA", async () => {
    mocks.runCommand.mockImplementation(
      async (_command: string, args: string[]) => {
        const dockerArgs = args[0] === "docker" ? args.slice(1) : args;
        return {
          stdout:
            dockerArgs[0] === "inspect"
              ? inspectedContainer("overtchat-stt-cpu", "stt-cpu")
              : "",
          stderr: "",
          exitCode: 0,
        };
      },
    );

    const result = await reconcileManagedSidecars(
      { command: "sudo", prefix: ["docker"] },
      config({
        stt: {
          provider: "bundled",
          bundledInstalled: true,
          accelerator: "gpu",
          gpuUuid: "GPU-4090",
        },
      }),
    );

    expect(result.removed).toEqual(["Parakeet (CPU)"]);
    expect(mocks.runCommand).toHaveBeenLastCalledWith(
      "sudo",
      [
        "docker",
        "container",
        "rm",
        "--force",
        "overtchat-stt-cpu",
      ],
      {},
    );
  });

  it("leaves a same-named container alone unless its Compose labels match", async () => {
    mocks.runCommand.mockImplementation(
      async (_command: string, args: string[]) => ({
        stdout: inspectedContainer(
          args[1] ?? "overtchat-searxng",
          "searxng",
          "someone-elses-project",
        ),
        stderr: "",
        exitCode: 0,
      }),
    );

    const result = await reconcileManagedSidecars(
      { command: "docker", prefix: [] },
      config({
        search: { provider: "disabled", bundledInstalled: false },
      }),
    );

    expect(result).toEqual({ removed: [], warnings: [] });
    expect(
      mocks.runCommand.mock.calls.some(
        ([, args]) => (args as string[])[0] === "container",
      ),
    ).toBe(false);
  });

  it("reports cleanup failures without turning a healthy update into a failure", async () => {
    mocks.runCommand.mockImplementation(
      async (_command: string, args: string[]) => {
        if (args[0] === "inspect") {
          return {
            stdout: inspectedContainer("overtchat-kokoro", "kokoro"),
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "container is busy", exitCode: 1 };
      },
    );

    const result = await reconcileManagedSidecars(
      { command: "docker", prefix: [] },
      config({
        tts: { provider: "disabled", bundledInstalled: false },
      }),
    );

    expect(result).toEqual({
      removed: [],
      warnings: ["Could not remove Kokoro: container is busy"],
    });
  });
});
