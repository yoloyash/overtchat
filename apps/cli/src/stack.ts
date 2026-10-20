import { appleSpeechCapabilities, type SpeechChange } from "./apple-speech.js";
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

// Roll back speech routing and its native process together; retain the current
// app image because it may already have migrated the database.
export async function recoverSpeech(
  change: SpeechChange,
  current: InstallationConfig,
  previous: InstallationConfig | null,
  secrets: InstallationSecrets,
  paths: RuntimePaths,
  docker: DockerCommand,
  waitForApp: (url: string) => Promise<void>,
  syncCapabilities: (config: InstallationConfig, secret: string) => Promise<void>,
  restorePreviousAccess = false,
): Promise<void> {
  if (!appleSpeechCapabilities(current).length &&
      !(previous && appleSpeechCapabilities(previous).length)) return;
  if (!previous) {
    // On a first installation there is no old routing to restore. Keep the
    // prepared service alive for the app and persist the selection for repair.
    await writeInstallationConfig(paths, current);
    return;
  }
  const restored = {
    ...current,
    ...(restorePreviousAccess ? accessSettings(previous) : {}),
    tts: previous.tts,
    stt: previous.stt,
    voice: previous.voice,
    search: previous.search,
    appleSpeechPort: previous.appleSpeechPort,
  };
  await change.rollback();
  await restoreAccess(restored, restored, secrets, paths, docker, waitForApp);
  await syncCapabilities(restored, secrets.managementSecret);
}
