import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  components,
  installationReport,
  ownedContainer,
  type Container,
} from "./management.js";
import {
  defaultInstallationConfig,
  readInstallationConfig,
  readInstallationSecrets,
} from "./config.js";
import { detectDockerCommand, runDocker } from "./docker.js";
import { runtimePaths } from "./paths.js";
import manifest from "../../site/public/install-manifest.json";
vi.mock("./config.js", async (original) => ({
  ...(await original<typeof import("./config.js")>()),
  readInstallationConfig: vi.fn(),
  readInstallationSecrets: vi.fn(),
}));
vi.mock("./docker.js", () => ({
  detectDockerCommand: vi.fn(),
  runDocker: vi.fn(),
}));
const config = () => ({
  ...defaultInstallationConfig(null, manifest as never),
  instanceId: "test-instance",
  agents: { installed: true },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readInstallationConfig).mockResolvedValue(config());
  vi.mocked(readInstallationSecrets).mockResolvedValue({
    managementSecret: "never-print-this",
  });
  vi.mocked(detectDockerCommand).mockResolvedValue({
    command: "docker",
    prefix: [],
  });
  vi.mocked(runDocker).mockResolvedValue({
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ok: true,
        name: "overtchat",
        instanceId: "test-instance",
        version: "99.0.0",
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("component discovery", () => {
  it("reflects selected GPU/native services without presenting disabled versions as installed", () => {
    const selected = config();
    selected.tts.accelerator = "apple";
    selected.stt = {
      provider: "bundled",
      bundledInstalled: true,
      accelerator: "gpu",
    };
    selected.voice.installed = true;
    expect(
      components(selected).map(({ id, service }) => [id, service]),
    ).toEqual([
      ["app", "app"],
      ["redis", "redis"],
      ["search", "searxng"],
      ["stt", "stt-gpu"],
      ["voice", "voice"],
      ["connector", undefined],
      ["speech", undefined],
    ]);
  });
  it("does not claim another checkout's containers", () => {
    const container = {
      Id: "id",
      Name: "/overtchat-app",
      State: { Status: "running" },
      Config: {
        Image: "app",
        Labels: {
          "com.docker.compose.project": config().composeProject,
          "com.docker.compose.service": "app",
          "com.docker.compose.project.working_dir": "/another/checkout",
        },
      },
    } as Container;
    expect(ownedContainer(container, config(), runtimePaths())).toBe(false);
    container.Config.Labels!["com.docker.compose.project.working_dir"] =
      runtimePaths().stackDirectory;
    expect(ownedContainer(container, config(), runtimePaths())).toBe(true);
  });
  it("reports running version drift and never serializes secrets", async () => {
    const report = await installationReport();
    expect(report.components.find((entry) => entry.id === "app")).toMatchObject(
      { running: "99.0.0", state: "ready" },
    );
    expect(report.problems).toContain(
      "App version differs from saved configuration. Run overtchat update to reconcile.",
    );
    expect(JSON.stringify(report)).not.toContain("never-print-this");
  });
  it("still reports configured components when Docker is unavailable", async () => {
    vi.mocked(detectDockerCommand).mockRejectedValue(
      new Error("Start Docker Desktop"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const report = await installationReport();
    expect(report.problems).toEqual(["Start Docker Desktop"]);
    expect(
      report.components.find((entry) => entry.id === "connector")?.state,
    ).toBe("offline");
  });
  it("does not send management credentials to a different installation on the saved port", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        name: "overtchat",
        instanceId: "another-instance",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await installationReport();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).not.toContain("never-print-this");
  });
});
