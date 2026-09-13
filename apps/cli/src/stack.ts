import { writeFile } from "node:fs/promises";
import { renderComposeFile, renderStackEnvironment } from "./compose.js";
import {
  writeInstallationConfig,
  writeSecretsFile,
  type InstallationSecrets,
} from "./config.js";
import { requireDocker, type DockerCommand } from "./docker.js";
import type { InstallationConfig, RuntimePaths } from "./types.js";

function accessSettings(config: InstallationConfig) {
  return {
    appPort: config.appPort,
    bindAddress: config.bindAddress,
    publicUrl: config.publicUrl,
    extraTrustedOrigins: config.extraTrustedOrigins,
    connectorServerUrl: config.connectorServerUrl,
    access: config.access,
    managedTailscaleRoute: config.managedTailscaleRoute,
  };
}

// Restore network configuration after a failed reconfiguration. Keep the current
// app image and data: rolling back software after a migration is a separate task.
export async function restoreAccess(
  config: InstallationConfig,
  previous: InstallationConfig,
  secrets: InstallationSecrets,
  paths: RuntimePaths,
  docker: DockerCommand,
  waitForApp: (url: string) => Promise<void>,
): Promise<void> {
  const restored = { ...config, ...accessSettings(previous) };
  await writeFile(paths.composeFile, renderComposeFile(restored), {
    mode: 0o600,
  });
  await writeSecretsFile(
    paths,
    renderStackEnvironment(restored, secrets, paths),
  );
  await requireDocker(
    docker,
    [
      "compose",
      "--env-file",
      paths.secretsFile,
      "-f",
      paths.composeFile,
      "up",
      "-d",
    ],
    { inherit: true },
  );
  await waitForApp(`http://127.0.0.1:${restored.appPort}`);
  await writeInstallationConfig(paths, restored);
}

export async function startStack(
  config: InstallationConfig,
  previous: InstallationConfig | null,
  secrets: InstallationSecrets,
  paths: RuntimePaths,
  docker: DockerCommand,
  waitForApp: (url: string) => Promise<void>,
): Promise<void> {
  try {
    await requireDocker(
      docker,
      [
        "compose",
        "--env-file",
        paths.secretsFile,
        "-f",
        paths.composeFile,
        "up",
        "-d",
      ],
      { inherit: true },
    );
    await waitForApp(`http://127.0.0.1:${config.appPort}`);
  } catch (error) {
    if (
      !previous ||
      JSON.stringify(accessSettings(config)) ===
        JSON.stringify(accessSettings(previous))
    )
      throw error;
    const failure = error instanceof Error ? error.message : String(error);
    try {
      await restoreAccess(config, previous, secrets, paths, docker, waitForApp);
    } catch (recoveryError) {
      throw new Error(
        `${failure}\nCould not restore the previous access settings: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}\nRun overtchat setup to repair the installation.`,
        { cause: error },
      );
    }
    throw new Error(
      `${failure}\nPrevious access settings restored. Open ${previous.publicUrl} and rerun overtchat setup to try again.`,
      { cause: error },
    );
  }
}
