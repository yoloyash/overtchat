import { prepareAppleSpeech, type SpeechChange } from "./apple-speech.js";
import { recoverSpeech } from "./stack.js";
import { platformServices } from "./platform.js";
import { outro, spinner } from "@clack/prompts";
import { accessSummary } from "./access.js";
import {
  initialSecrets,
  normalizeInstallationConfig,
  readInstallationConfig,
  readInstallationSecrets,
  writeInstallationConfig,
  writeSecretsFile,
} from "./config.js";
import { installManagedConnector } from "./connector.js";
import { renderStackEnvironment } from "./compose.js";
import {
  detectDockerCommand,
  dockerComposeAvailable,
  reconcileManagedSidecars,
  requireDocker,
} from "./docker.js";
import { runtimePaths } from "./paths.js";
import { requireSuccessful } from "./process.js";
import {
  applyReleaseManifest,
  latestReleaseManifest,
  updateCliIfNeeded,
} from "./release.js";
import {
  prepareFiles,
  showSidecarReconciliation,
  waitForApp,
} from "./setup.js";
import { printUpdatePlan, updatePlan } from "./update-plan.js";

export async function update(options: { check?: boolean; json?: boolean } = {}): Promise<void> {
  const paths = runtimePaths();
  const config = await readInstallationConfig(paths);
  if (!config) {
    throw new Error("OvertChat is not managed yet. Run overtchat setup first.");
  }
  if (options.check) {
    const manifest = await latestReleaseManifest();
    if (options.json) console.log(JSON.stringify(updatePlan(config, manifest), null, 2));
    else printUpdatePlan(config, manifest);
    return;
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
  const completedSecrets = initialSecrets(null, secrets);
  const progress = spinner();
  let progressActive = true;
  let nextConfig = config;
  let speechChange: SpeechChange | undefined;
  progress.start("Checking for OvertChat updates");
  try {
    const manifest = await latestReleaseManifest();
    printUpdatePlan(config, manifest);
    const updatedExecutable = await updateCliIfNeeded(manifest);
    if (updatedExecutable) {
      progress.stop("OvertChat manager updated");
      progressActive = false;
      await requireSuccessful(updatedExecutable, ["update"], { inherit: true });
      return;
    }

    nextConfig = normalizeInstallationConfig(
      platformServices(applyReleaseManifest(config, manifest)),
    );
    await prepareFiles(nextConfig, undefined);
    await writeSecretsFile(
      paths,
      renderStackEnvironment(nextConfig, completedSecrets, paths),
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
    progress.message("Preparing local speech");
    speechChange = await prepareAppleSpeech(nextConfig, secrets.managementSecret, paths);
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
    progress.message("Reconciling bundled services");
    await speechChange.commit();
    speechChange = undefined;
    const reconciliation = await reconcileManagedSidecars(docker, nextConfig);
    progress.stop("OvertChat is up to date");
    progressActive = false;
    showSidecarReconciliation(reconciliation);
    outro(nextConfig.access ? accessSummary(nextConfig) : `Open: ${nextConfig.publicUrl}`);
  } catch (error) {
    if (speechChange) {
      try {
        await recoverSpeech(speechChange, nextConfig, config, completedSecrets, paths, docker, waitForApp, async () => {});
      } catch (recoveryError) {
        if (progressActive) progress.stop("OvertChat update failed", 1);
        throw new AggregateError([error, recoveryError], "Update failed and speech recovery failed. Run overtchat setup to repair the installation.");
      }
    }
    if (progressActive) progress.stop("OvertChat update failed", 1);
    throw error;
  }
}
