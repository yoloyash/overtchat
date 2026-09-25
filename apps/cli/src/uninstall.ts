import { confirm, isCancel, text } from "@clack/prompts";
import { lstat, realpath, rm, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requireDocker, runDocker } from "./docker.js";
import {
  managedDocker,
  managedInstallation,
  ownedContainer,
  projectContainers,
} from "./management.js";
import { manageNative, nativeServices } from "./native-services.js";
import { removeServe } from "./tailscale.js";
import type { InstallationConfig, RuntimePaths } from "./types.js";

export type UninstallOptions = {
  dryRun: boolean;
  purge: boolean;
  yes: boolean;
  removeCli: boolean;
};
export function purgeCandidates(
  config: InstallationConfig,
  paths: RuntimePaths,
): string[] {
  return [
    paths.stateFile,
    paths.secretsFile,
    paths.composeFile,
    paths.searxngDirectory,
    path.join(paths.stackDirectory, "apple-speech"),
  ];
}
export async function assertPurgePaths(paths: RuntimePaths): Promise<void> {
  const protectedPaths = new Set([
    "/",
    os.homedir(),
    path.join(os.homedir(), ".config"),
    path.join(os.homedir(), ".local"),
    path.join(os.homedir(), ".local", "share"),
  ]);
  for (const directory of [paths.configDirectory, paths.stackDirectory]) {
    const resolved = path.resolve(directory);
    if (protectedPaths.has(resolved))
      throw new Error(
        `Refusing to purge files in unsafe directory ${resolved}.`,
      );
    try {
      if (
        (await lstat(directory)).isSymbolicLink() ||
        (await realpath(directory)) !== resolved
      )
        throw new Error(`Refusing to purge through a symlink: ${directory}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export async function uninstall(options: UninstallOptions): Promise<void> {
  const { config, paths } = await managedInstallation();
  if (options.purge) await assertPurgePaths(paths);
  const docker = await managedDocker();
  const containers = await projectContainers(docker, config);
  if (containers.some((container) => !ownedContainer(container, config, paths)))
    throw new Error(
      "The Compose project includes unmanaged resources. Refusing uninstall; resolve the ownership conflict first.",
    );
  const native = await nativeServices(config, paths);
  const nativeData = native.flatMap((service) => [
    ...(service.configFile ? [service.configFile] : []),
    ...(service.dataFiles ?? []),
    ...service.logs,
  ]);
  const volumeNames = new Set<string>();
  const volumes = await runDocker(docker, [
    "volume",
    "ls",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${config.composeProject}`,
  ]);
  if (volumes.exitCode) throw new Error("Could not inspect managed volumes.");
  // Only these generated caches belong to the managed Compose template.
  for (const name of volumes.stdout.trim().split(/\s+/u).filter(Boolean)) {
    const inspected = await requireDocker(docker, ["volume", "inspect", name]);
    const [volume] = JSON.parse(inspected.stdout) as Array<{
      Labels?: Record<string, string>;
    }>;
    if (
      ["overtchat-npm-cache", "overtchat-stt-models"].includes(
        volume?.Labels?.["com.docker.compose.volume"] ?? "",
      )
    )
      volumeNames.add(name);
  }
  let purgeData = false;
  if (
    options.purge &&
    config.dataMountType === "volume" &&
    config.dataVolumeOwned &&
    config.instanceId
  ) {
    const inspected = await runDocker(docker, [
      "volume",
      "inspect",
      config.dataVolume,
    ]);
    if (inspected.exitCode === 0) {
      const [volume] = JSON.parse(inspected.stdout) as Array<{
        Labels?: Record<string, string>;
      }>;
      purgeData =
        volume?.Labels?.["com.overtchat.instance"] === config.instanceId;
      if (!purgeData)
        throw new Error(
          "The data volume ownership label no longer matches this installation. Refusing purge.",
        );
    }
  }
  const networksResult = await requireDocker(docker, [
    "network",
    "ls",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${config.composeProject}`,
  ]);
  const networks: string[] = [];
  const retainedNetworks: string[] = [];
  for (const id of networksResult.stdout.trim().split(/\s+/u).filter(Boolean)) {
    const inspected = await requireDocker(docker, ["network", "inspect", id]);
    const [network] = JSON.parse(inspected.stdout) as Array<{
      Name: string;
      Labels?: Record<string, string>;
      Containers?: Record<string, unknown>;
    }>;
    if (
      network?.Labels?.["com.docker.compose.network"] === "default" &&
      Object.keys(network.Containers ?? {}).every((containerId) =>
        containers.some((container) => container.Id === containerId),
      )
    )
      networks.push(network.Name);
    else if (network) retainedNetworks.push(network.Name);
  }
  const cli = process.execPath;
  if (
    options.removeCli &&
    !/^overtchat(?:-(?:linux|darwin)-(?:amd64|arm64))?$/u.test(
      path.basename(cli),
    )
  )
    throw new Error(
      "--remove-cli requires the installed OvertChat binary; it cannot remove Node, Bun, or a source checkout.",
    );
  const remove = [
    ...containers.map(
      (container) => `Container: ${container.Name.replace(/^\//u, "")}`,
    ),
    ...networks.map((name) => `Network: ${name}`),
    ...native.flatMap((service) => [
      `Service: ${service.file}`,
      ...(service.binary ? [`Executable: ${service.binary}`] : []),
    ]),
    ...(config.managedTailscaleRoute
      ? [
          `Tailscale route: ${config.managedTailscaleRoute.hostname}:${config.managedTailscaleRoute.port}`,
        ]
      : []),
    ...(options.purge
      ? [...volumeNames].map((name) => `Cache volume: ${name}`)
      : []),
    ...(purgeData ? [`Data volume: ${config.dataVolume}`] : []),
    ...(options.purge
      ? purgeCandidates(config, paths).map((file) => `File/directory: ${file}`)
      : []),
    ...(options.purge
      ? nativeData.map((file) => `Native service data: ${file}`)
      : []),
    ...(options.removeCli ? [`CLI: ${cli}`] : []),
  ];
  console.log(
    `Remove:\n${remove.length ? remove.map((item) => `  ${item}`).join("\n") : "  No runtime resources remain."}`,
  );
  if (!purgeData)
    console.log(
      `Retain data: ${config.dataMountType} ${config.dataVolume}${options.purge ? " (adopted or ownership unproven; remove manually if intended)" : ""}`,
    );
  if (!options.purge)
    console.log(
      `Retain configuration, secrets, models and caches: ${paths.configDirectory}, ${paths.stackDirectory}`,
    );
  if (!options.purge && volumeNames.size)
    console.log(`Retain cache volumes: ${[...volumeNames].join(", ")}`);
  if (retainedNetworks.length)
    console.log(
      `Retain shared/unmanaged networks: ${retainedNetworks.join(", ")}`,
    );
  console.log(
    `Retain: shared Docker images, Docker, Tailscale, coding agents${options.purge ? "." : ", and connector session history."}`,
  );
  if (!options.removeCli)
    console.log(
      "Retain management CLI. Use --remove-cli to remove its installed binary too.",
    );
  if (options.dryRun) return;
  if (!options.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error(
        "Uninstall needs confirmation. Review --dry-run, then pass --yes for unattended removal.",
      );
    const accepted = options.purge
      ? await text({
          message: `Delete the listed data permanently? Type ${config.composeProject} to confirm.`,
        })
      : await confirm({
          message:
            "Remove the listed OvertChat runtime resources and preserve data?",
          initialValue: false,
        });
    if (
      isCancel(accepted) ||
      (options.purge ? accepted !== config.composeProject : accepted !== true)
    ) {
      console.log("Uninstall cancelled.");
      return;
    }
  }
  // Remove the owned route first: conflict detection must happen before tearing down the stack.
  if (config.managedTailscaleRoute)
    await removeServe(config.managedTailscaleRoute);
  for (const service of [...native].reverse())
    await manageNative(service, "remove");
  if (containers.length) {
    await requireDocker(
      docker,
      ["stop", ...containers.map((container) => container.Id)],
      { inherit: true },
    );
    await requireDocker(
      docker,
      ["rm", ...containers.map((container) => container.Id)],
      { inherit: true },
    );
  }
  for (const network of networks)
    await requireDocker(docker, ["network", "rm", network]);
  for (const service of native)
    if (service.binary) await rm(service.binary, { force: true });
  if (options.purge) {
    for (const volume of [
      ...volumeNames,
      ...(purgeData ? [config.dataVolume] : []),
    ])
      await requireDocker(docker, ["volume", "rm", volume]);
    for (const file of [...nativeData, ...purgeCandidates(config, paths)])
      await rm(file, { recursive: true, force: true });
    for (const directory of new Set([
      paths.configDirectory,
      paths.stackDirectory,
    ])) {
      try {
        await rmdir(directory);
      } catch (error) {
        if (
          !["ENOENT", "ENOTEMPTY"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    }
  }
  if (options.removeCli) await rm(cli);
  console.log(
    options.purge
      ? "OvertChat removed. Any retained resources are listed above."
      : "OvertChat removed; data retained. Run overtchat setup to reinstall.",
  );
}
