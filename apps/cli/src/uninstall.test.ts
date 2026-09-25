import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultInstallationConfig,
  writeInstallationConfig,
  writeSecretsFile,
} from "./config.js";
import { requireDocker, runDocker } from "./docker.js";
import { managedDocker, projectContainers } from "./management.js";
import { nativeServices, manageNative } from "./native-services.js";
import { runtimePaths } from "./paths.js";
import { uninstall } from "./uninstall.js";
import { removeServe } from "./tailscale.js";
import manifest from "../../site/public/install-manifest.json";
vi.mock("./docker.js", () => ({ requireDocker: vi.fn(), runDocker: vi.fn() }));
vi.mock("./management.js", async (original) => ({
  ...(await original<typeof import("./management.js")>()),
  managedDocker: vi.fn(),
  projectContainers: vi.fn(),
}));
vi.mock("./native-services.js", () => ({
  nativeServices: vi.fn(),
  manageNative: vi.fn(),
}));
vi.mock("./tailscale.js", () => ({ removeServe: vi.fn() }));
let directory: string;
const options = { dryRun: false, purge: false, yes: true, removeCli: false };
const successful = (stdout = "") => ({ stdout, stderr: "", exitCode: 0 });
beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-uninstall-"));
  vi.stubEnv("OVERTCHAT_CONFIG_DIR", path.join(directory, "config"));
  vi.stubEnv("OVERTCHAT_STACK_DIR", path.join(directory, "stack"));
  const paths = runtimePaths();
  const config = {
    ...defaultInstallationConfig(null, manifest as never),
    instanceId: "test-owner",
    dataVolumeOwned: true,
  };
  await writeInstallationConfig(paths, config);
  await writeSecretsFile(paths, "retained-secret");
  await mkdir(paths.stackDirectory, { recursive: true });
  await writeFile(paths.composeFile, "compose");
  vi.mocked(managedDocker).mockResolvedValue({ command: "docker", prefix: [] });
  vi.mocked(projectContainers).mockResolvedValue([
    {
      Id: "container-id",
      Name: "/overtchat-app",
      State: { Status: "running" },
      Config: {
        Image: config.appImage,
        Labels: {
          "com.docker.compose.project": config.composeProject,
          "com.docker.compose.service": "app",
          "com.docker.compose.project.working_dir": paths.stackDirectory,
        },
      },
    },
  ]);
  vi.mocked(nativeServices).mockResolvedValue([]);
  vi.mocked(runDocker).mockImplementation(async (_docker, args) =>
    successful(
      args[1] === "inspect"
        ? JSON.stringify([
            { Labels: { "com.overtchat.instance": "test-owner" } },
          ])
        : "",
    ),
  );
  vi.mocked(requireDocker).mockResolvedValue(successful());
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
describe("managed uninstall", () => {
  it("preserves data, secrets, images and host prerequisites by default", async () => {
    await uninstall(options);
    expect(await readFile(runtimePaths().secretsFile, "utf8")).toBe(
      "retained-secret",
    );
    const commands = vi
      .mocked(requireDocker)
      .mock.calls.map(([, args]) => args);
    expect(commands).toContainEqual(["stop", "container-id"]);
    expect(commands).toContainEqual(["rm", "container-id"]);
    expect(
      commands.some((args) => args[0] === "volume" && args[1] === "rm"),
    ).toBe(false);
    expect(commands.some((args) => args.includes("prune"))).toBe(false);
  });
  it("dry run previews purge but changes no files, containers, routes or services", async () => {
    await uninstall({ ...options, purge: true, dryRun: true });
    expect(await readFile(runtimePaths().secretsFile, "utf8")).toBe(
      "retained-secret",
    );
    expect(manageNative).not.toHaveBeenCalled();
    expect(removeServe).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(requireDocker)
        .mock.calls.every(
          ([, args]) => args.includes("ls") || args.includes("inspect"),
        ),
    ).toBe(true);
  });
  it("purges an explicitly owned data volume and managed files", async () => {
    await uninstall({ ...options, purge: true });
    expect(requireDocker).toHaveBeenCalledWith(expect.anything(), [
      "volume",
      "rm",
      "overtchat-data",
    ]);
    await expect(readFile(runtimePaths().stateFile)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("retains adopted bind storage even with purge", async () => {
    const paths = runtimePaths();
    const data = path.join(directory, "adopted-data");
    await mkdir(data);
    await writeFile(path.join(data, "chat.db"), "precious");
    await writeInstallationConfig(paths, {
      ...defaultInstallationConfig(null, manifest as never),
      dataMountType: "bind",
      dataVolume: data,
    });
    await uninstall({ ...options, purge: true });
    expect(await readFile(path.join(data, "chat.db"), "utf8")).toBe("precious");
  });
  it("retains legacy volumes whose ownership is not recorded", async () => {
    await writeInstallationConfig(
      runtimePaths(),
      defaultInstallationConfig(null, manifest as never),
    );
    await uninstall({ ...options, purge: true });
    expect(
      vi
        .mocked(requireDocker)
        .mock.calls.some(
          ([, args]) => args[0] === "volume" && args[1] === "rm",
        ),
    ).toBe(false);
  });
  it("rejects mismatched ownership before stopping anything", async () => {
    vi.mocked(runDocker).mockImplementation(async (_docker, args) =>
      successful(
        args[1] === "inspect"
          ? '[{"Labels":{"com.overtchat.instance":"other"}}]'
          : "",
      ),
    );
    await expect(uninstall({ ...options, purge: true })).rejects.toThrow(
      "ownership label",
    );
    expect(manageNative).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(requireDocker)
        .mock.calls.some(([, args]) => args.includes("stop")),
    ).toBe(false);
  });
  it("refuses another checkout in the same Compose project", async () => {
    const containers = await projectContainers(
      { command: "docker", prefix: [] },
      {} as never,
    );
    containers[0]!.Config.Labels!["com.docker.compose.project.working_dir"] =
      "/other/checkout";
    await expect(uninstall(options)).rejects.toThrow("unmanaged resources");
    expect(requireDocker).not.toHaveBeenCalled();
  });
  it("does not purge through a symlinked stack directory", async () => {
    const target = path.join(directory, "foreign");
    await mkdir(target);
    await rm(runtimePaths().stackDirectory, { recursive: true });
    await symlink(target, runtimePaths().stackDirectory);
    await expect(uninstall({ ...options, purge: true })).rejects.toThrow(
      "symlink",
    );
    expect(requireDocker).not.toHaveBeenCalled();
  });
  it("does not remove Node when invoked from source", async () => {
    await expect(uninstall({ ...options, removeCli: true })).rejects.toThrow(
      "cannot remove Node",
    );
  });
  it("requires explicit confirmation when stdin is not a terminal", async () => {
    await expect(uninstall({ ...options, yes: false })).rejects.toThrow(
      "confirmation",
    );
    expect(manageNative).not.toHaveBeenCalled();
  });
});
