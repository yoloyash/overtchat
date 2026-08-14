import { outro, spinner } from "@clack/prompts";
import {
  readInstallationConfig,
  readInstallationSecrets,
  writeInstallationConfig,
  writeSecretsFile,
} from "./config.js";
import { installManagedConnector } from "./connector.js";
import { APP_IMAGE } from "./constants.js";
import { renderStackEnvironment } from "./compose.js";
import {
  detectDockerCommand,
  dockerComposeAvailable,
  requireDocker,
} from "./docker.js";
import { runtimePaths } from "./paths.js";
import { requireSuccessful } from "./process.js";
import {
  compareVersions,
  latestReleaseManifest,
  updateCliIfNeeded,
} from "./release.js";
import { prepareFiles, waitForApp } from "./setup.js";

export async function update(): Promise<void> {
  const paths = runtimePaths();
  const config = await readInstallationConfig(paths);
  if (!config) {
    throw new Error("OvertChat is not managed yet. Run overtchat setup first.");
  }
  const docker = await detectDockerCommand();
  if (!docker || !(await dockerComposeAvailable(docker))) {
    throw new Error("Docker Engine and Docker Compose v2 are required.");
  }
  const secrets = await readInstallationSecrets(paths);
  if (
    !secrets.betterAuthSecret ||
    !secrets.managementSecret ||
    !secrets.searxngSecret
  ) {
    throw new Error(
      "The managed installation secrets are incomplete. Run overtchat setup to repair them.",
    );
  }
  const progress = spinner();
  progress.start("Checking for OvertChat updates");
  const manifest = await latestReleaseManifest();
  const updatedExecutable = await updateCliIfNeeded(manifest);
  if (updatedExecutable) {
    progress.stop("OvertChat manager updated");
    await requireSuccessful(updatedExecutable, ["update"], { inherit: true });
    return;
  }

  const appVersion =
    compareVersions(manifest.appVersion, config.appVersion) > 0
      ? manifest.appVersion
      : config.appVersion;
  const connectorVersion =
    compareVersions(manifest.connectorVersion, config.connectorVersion) > 0
      ? manifest.connectorVersion
      : config.connectorVersion;
  const sttVersion =
    compareVersions(manifest.sttVersion, config.sttVersion) > 0
      ? manifest.sttVersion
      : config.sttVersion;
  const nextConfig = {
    ...config,
    appVersion,
    appImage: config.appImage === "overtchat-app:setup-dev"
      ? config.appImage
      : `${APP_IMAGE}:${appVersion}`,
    connectorVersion,
    sttVersion,
  };
  await prepareFiles(nextConfig, undefined);
  await writeSecretsFile(
    paths,
    renderStackEnvironment(nextConfig, {
      betterAuthSecret: secrets.betterAuthSecret,
      managementSecret: secrets.managementSecret,
      searxngSecret: secrets.searxngSecret,
    }, paths),
  );
  const composeArgs = [
    "compose",
    "--env-file",
    paths.secretsFile,
    "-f",
    paths.composeFile,
  ];
  progress.message("Downloading installed components");
  await requireDocker(
    docker,
    [
      ...composeArgs,
      "pull",
      ...(nextConfig.appImage === "overtchat-app:setup-dev"
        ? ["--ignore-pull-failures"]
        : []),
    ],
    { inherit: true },
  );
  progress.message("Applying updates and database migrations");
  await requireDocker(docker, [...composeArgs, "up", "-d"], {
    inherit: true,
  });
  progress.message("Waiting for OvertChat and database migrations");
  await waitForApp(`http://127.0.0.1:${nextConfig.appPort}`);
  if (nextConfig.agents.installed) {
    progress.message("Updating Agent Connections");
    await installManagedConnector(nextConfig, secrets.managementSecret);
  }
  await writeInstallationConfig(paths, nextConfig);
  progress.stop("OvertChat is up to date");
  outro(`Open: ${nextConfig.publicUrl}`);
}
