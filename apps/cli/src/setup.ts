import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { confirm, isCancel, note, outro, spinner } from "@clack/prompts";
import {
  defaultInstallationConfig,
  initialSecrets,
  readInstallationConfig,
  readInstallationSecrets,
  writeInstallationConfig,
  writeSecretsFile,
} from "./config.js";
import { installManagedConnector } from "./connector.js";
import {
  renderComposeFile,
  renderStackEnvironment,
  SEARXNG_SETTINGS,
} from "./compose.js";
import {
  detectDockerCommand,
  detectExistingInstallation,
  detectNvidiaGpus,
  dockerComposeAvailable,
  installDockerEngine,
  installNvidiaContainerToolkit,
  nvidiaContainerRuntimeAvailable,
  reconcileManagedSidecars,
  requireDocker,
  runDocker,
  type SidecarReconciliation,
} from "./docker.js";
import { primaryLanAddress } from "./network.js";
import { runtimePaths } from "./paths.js";
import { requireSuccessful } from "./process.js";
import {
  kokoroGpuVariant,
  promptInstallationConfig,
} from "./prompts.js";
import {
  applyReleaseManifest,
  parseReleaseManifest,
  type ReleaseManifest,
} from "./release.js";
import { createPreMigrationSnapshot } from "./snapshot.js";
import type { ExistingInstallation, InstallationConfig } from "./types.js";

export type SetupOptions = {
  dryRun: boolean;
  defaults: boolean;
  development: boolean;
};

type RunningCapability = {
  id: "search" | "tts" | "stt";
  provider: string;
  bundledInstalled: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  voice: string | null;
};

type CapabilityPayload = Omit<RunningCapability, "apiKey"> & {
  apiKey: string | null;
};

async function runningCapabilities(
  config: InstallationConfig,
  managementSecret: string | undefined,
): Promise<RunningCapability[] | null> {
  if (!managementSecret) return null;
  const response = await fetch(
    `http://127.0.0.1:${config.appPort}/api/internal/management/capabilities`,
    {
      headers: { Authorization: `Bearer ${managementSecret}` },
      signal: AbortSignal.timeout(3_000),
    },
  ).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    capabilities?: RunningCapability[];
  } | null;
  return Array.isArray(body?.capabilities) ? body.capabilities : null;
}

function mergeRunningCapabilities(
  config: InstallationConfig,
  capabilities: RunningCapability[] | null,
): InstallationConfig {
  if (!capabilities) return config;
  const search = capabilities.find((capability) => capability.id === "search");
  const tts = capabilities.find((capability) => capability.id === "tts");
  const stt = capabilities.find((capability) => capability.id === "stt");
  return {
    ...config,
    search: search
      ? {
          provider: search.provider as InstallationConfig["search"]["provider"],
          bundledInstalled: search.bundledInstalled,
          baseUrl: search.baseUrl ?? undefined,
          apiKey: search.apiKey ?? undefined,
        }
      : config.search,
    tts: tts
      ? {
          ...config.tts,
          provider: tts.provider as InstallationConfig["tts"]["provider"],
          bundledInstalled: tts.bundledInstalled,
          baseUrl: tts.baseUrl ?? undefined,
          apiKey: tts.apiKey ?? undefined,
          model: tts.model ?? undefined,
          voice: tts.voice ?? undefined,
        }
      : config.tts,
    stt: stt
      ? {
          ...config.stt,
          provider: stt.provider as InstallationConfig["stt"]["provider"],
          bundledInstalled: stt.bundledInstalled,
          baseUrl: stt.baseUrl ?? undefined,
          apiKey: stt.apiKey ?? undefined,
          model: stt.model ?? undefined,
        }
      : config.stt,
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export async function prepareFiles(
  config: InstallationConfig,
  existingSearxngConfigPath: string | undefined,
): Promise<void> {
  const paths = runtimePaths();
  await mkdir(paths.stackDirectory, { recursive: true, mode: 0o700 });
  await mkdir(paths.searxngDirectory, { recursive: true, mode: 0o700 });
  if (
    config.search.provider === "bundled" &&
    existingSearxngConfigPath &&
    existingSearxngConfigPath !== paths.searxngDirectory &&
    !(await exists(paths.searxngSettingsFile))
  ) {
    await cp(existingSearxngConfigPath, paths.searxngDirectory, {
      recursive: true,
      force: false,
    });
  }
  if (!(await exists(paths.searxngSettingsFile))) {
    await writeFile(paths.searxngSettingsFile, SEARXNG_SETTINGS, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  await writeFile(paths.composeFile, renderComposeFile(config), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function waitForApp(url: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (response && response.status >= 200 && response.status < 500) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("OvertChat did not become ready within three minutes.");
}

export async function syncCapabilities(
  config: InstallationConfig,
  managementSecret: string,
): Promise<void> {
  const running = await runningCapabilities(config, managementSecret);
  const existingApiKey = (id: RunningCapability["id"]): string | null =>
    running?.find((capability) => capability.id === id)?.apiKey ?? null;
  const apiKey = (
    configured: string | undefined,
    id: RunningCapability["id"],
  ): string | null =>
    configured === undefined ? existingApiKey(id) : configured.trim() || null;
  const capabilities: CapabilityPayload[] = [
    {
      id: "search",
      provider: config.search.provider,
      bundledInstalled: config.search.bundledInstalled,
      baseUrl: config.search.baseUrl ?? null,
      apiKey: apiKey(config.search.apiKey, "search"),
      model: null,
      voice: null,
    },
    {
      id: "tts",
      provider: config.tts.provider,
      bundledInstalled: config.tts.bundledInstalled,
      baseUrl: config.tts.baseUrl ?? null,
      apiKey: apiKey(config.tts.apiKey, "tts"),
      model:
        config.tts.model ??
        (config.tts.provider === "bundled" ? "kokoro" : null),
      voice:
        config.tts.voice ??
        (config.tts.provider === "bundled" ? "af_heart" : null),
    },
    {
      id: "stt",
      provider: config.stt.provider,
      bundledInstalled: config.stt.bundledInstalled,
      baseUrl: config.stt.baseUrl ?? null,
      apiKey: apiKey(config.stt.apiKey, "stt"),
      model:
        config.stt.model ??
        (config.stt.provider === "bundled"
          ? "parakeet-tdt-0.6b-v3"
          : null),
      voice: null,
    },
  ];
  const response = await fetch(
    `http://127.0.0.1:${config.appPort}/api/internal/management/capabilities`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${managementSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ capabilities }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `OvertChat rejected its capability configuration (${response.status})${
        detail ? `: ${detail}` : ""
      }`,
    );
  }
}

export function showSidecarReconciliation(
  reconciliation: SidecarReconciliation,
): void {
  if (reconciliation.removed.length > 0) {
    note(
      `Removed unused containers: ${reconciliation.removed.join(", ")}\nImages and service data were preserved.`,
      "Bundled service cleanup",
    );
  }
  if (reconciliation.warnings.length > 0) {
    note(reconciliation.warnings.join("\n"), "Bundled service cleanup warning");
  }
}

export function installationNeedsAdoption(
  existing: ExistingInstallation | null,
  managedStackDirectory: string,
): existing is ExistingInstallation {
  if (!existing) return false;
  if (!existing.composeWorkingDir) return true;
  return (
    path.resolve(existing.composeWorkingDir) !==
    path.resolve(managedStackDirectory)
  );
}

async function developmentReleaseManifest(
  sourceDirectory: string,
): Promise<ReleaseManifest> {
  const manifestPath = path.join(
    sourceDirectory,
    "apps",
    "site",
    "public",
    "install-manifest.json",
  );
  return parseReleaseManifest(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
}

export async function setup(
  options: SetupOptions,
  productionManifest?: ReleaseManifest,
): Promise<void> {
  if (process.platform !== "linux") {
    throw new Error("The managed OvertChat installer currently supports Linux.");
  }
  const sourceDirectory = path.resolve(
    process.env.OVERTCHAT_SOURCE_DIR || process.env.INIT_CWD || process.cwd(),
  );
  const manifest = options.development
    ? await developmentReleaseManifest(sourceDirectory)
    : productionManifest;
  if (!manifest) {
    throw new Error("A release manifest is required for production setup.");
  }
  let docker = await detectDockerCommand();
  if (!docker) {
    if (options.defaults) {
      throw new Error("Docker Engine was not found.");
    }
    const installDocker = await confirm({
      message: "Docker Engine is not installed. Install it now?",
      initialValue: true,
      active: "Yes",
      inactive: "No",
    });
    if (isCancel(installDocker) || !installDocker) {
      throw new Error("Docker Engine is required to install OvertChat.");
    }
    const dockerProgress = spinner();
    dockerProgress.start("Installing Docker Engine");
    await installDockerEngine();
    dockerProgress.stop("Docker Engine installed");
    docker = await detectDockerCommand();
    if (!docker) throw new Error("Docker was installed but could not be started.");
  }
  if (!(await dockerComposeAvailable(docker))) {
    throw new Error("Docker Compose v2 was not found.");
  }

  const paths = runtimePaths();
  const existing = await detectExistingInstallation(docker);
  const saved = await readInstallationConfig(paths);
  const adopting = installationNeedsAdoption(existing, paths.stackDirectory);
  const previousSecrets = await readInstallationSecrets(paths);
  let config = saved ?? defaultInstallationConfig(existing, manifest);
  config = applyReleaseManifest(config, manifest);
  if (saved) {
    config = mergeRunningCapabilities(
      config,
      await runningCapabilities(config, previousSecrets.managementSecret),
    );
  }
  if (options.development) {
    if (!(await exists(path.join(sourceDirectory, "Dockerfile")))) {
      throw new Error(
        `No OvertChat Dockerfile was found in ${sourceDirectory}. Set OVERTCHAT_SOURCE_DIR to the repository root.`,
      );
    }
    config = {
      ...config,
      appImage: "overtchat-app:setup-dev",
      voiceImage: "overtchat-voice:setup-dev",
    };
  }
  if (!saved && !existing) {
    const lanAddress = primaryLanAddress();
    if (lanAddress) config.publicUrl = `http://${lanAddress}:${config.appPort}`;
  }
  const gpus = await detectNvidiaGpus();
  if (
    (config.tts.accelerator === "auto" || config.tts.accelerator === "gpu") &&
    !config.tts.gpuVariant
  ) {
    const selectedGpu =
      gpus.find((gpu) => gpu.uuid === config.tts.gpuUuid) ??
      [...gpus].sort((left, right) => right.memoryMiB - left.memoryMiB)[0];
    config.tts = {
      ...config.tts,
      gpuUuid: selectedGpu?.uuid ?? config.tts.gpuUuid,
      gpuVariant: kokoroGpuVariant(selectedGpu),
    };
  }
  if (!options.defaults) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(
        "Interactive setup needs a terminal. Re-run with --defaults for an unattended test install.",
      );
    }
    config = await promptInstallationConfig(
      config,
      gpus,
      adopting ? existing ?? undefined : undefined,
    );
  } else if (gpus.length > 0 && config.stt.provider === "bundled") {
    const gpu = [...gpus].sort((left, right) => right.memoryMiB - left.memoryMiB)[0];
    config.stt = {
      provider: "bundled",
      bundledInstalled: true,
      accelerator: "auto",
      gpuUuid: gpu?.uuid,
    };
  }

  const ttsUsesGpu =
    config.tts.provider === "bundled" &&
    (config.tts.accelerator === "auto" || config.tts.accelerator === "gpu");
  const sttUsesGpu =
    config.stt.provider === "bundled" && config.stt.accelerator !== "cpu";
  if (
    (ttsUsesGpu || sttUsesGpu) &&
    !(await nvidiaContainerRuntimeAvailable(docker))
  ) {
    if (options.defaults) {
      if (ttsUsesGpu) {
        config.tts = {
          ...config.tts,
          accelerator: "cpu",
          gpuUuid: undefined,
          gpuVariant: undefined,
        };
      }
      if (sttUsesGpu) {
        config.stt = { ...config.stt, accelerator: "cpu", gpuUuid: undefined };
      }
    } else {
      const installToolkit = await confirm({
        message:
          "The NVIDIA Container Toolkit is missing. Install and configure it now?",
        initialValue: true,
        active: "Yes",
        inactive: "Use CPU",
      });
      if (isCancel(installToolkit)) {
        throw new Error("NVIDIA Container Toolkit installation was cancelled.");
      }
      if (installToolkit) {
        const toolkitProgress = spinner();
        toolkitProgress.start("Installing NVIDIA Container Toolkit");
        await installNvidiaContainerToolkit();
        toolkitProgress.stop("NVIDIA Container Toolkit installed");
        if (!(await nvidiaContainerRuntimeAvailable(docker))) {
          throw new Error(
            "The NVIDIA Container Toolkit was installed, but Docker does not report the NVIDIA runtime.",
          );
        }
      } else {
        if (ttsUsesGpu) {
          config.tts = {
            ...config.tts,
            accelerator: "cpu",
            gpuUuid: undefined,
            gpuVariant: undefined,
          };
        }
        if (sttUsesGpu) {
          config.stt = { ...config.stt, accelerator: "cpu", gpuUuid: undefined };
        }
      }
    }
  }

  const secrets = initialSecrets(
    existing,
    previousSecrets,
  );
  await prepareFiles(config, existing?.searxngConfigPath);
  await writeSecretsFile(
    paths,
    renderStackEnvironment(config, secrets, paths),
  );

  const composeArgs = [
    "compose",
    "--env-file",
    paths.secretsFile,
    "-f",
    paths.composeFile,
  ];
  await requireDocker(docker, [...composeArgs, "config"]);
  if (options.dryRun) {
    await writeInstallationConfig(paths, config);
    outro(`Configuration written to ${paths.stackDirectory}`);
    return;
  }

  const preparation = spinner();
  preparation.start(
    adopting
      ? "Preparing the existing OvertChat installation"
      : "Preparing OvertChat data",
  );
  if (config.dataMountType === "volume") {
    const volume = await runDocker(docker, ["volume", "inspect", config.dataVolume]);
    if (volume.exitCode !== 0) {
      await requireDocker(docker, ["volume", "create", config.dataVolume]);
    }
  }
  if (options.development) {
    preparation.message("Building the OvertChat app from this worktree");
    await requireDocker(
      docker,
      ["build", "--tag", config.appImage, sourceDirectory],
      { inherit: true },
    );
    if (config.voice.installed) {
      preparation.message("Building realtime voice from this worktree");
      await requireDocker(
        docker,
        [
          "build",
          "--tag",
          config.voiceImage,
          path.join(sourceDirectory, "voice"),
        ],
        { inherit: true },
      );
    }
    if (config.agents.installed) {
      preparation.message("Building Agent Connections from this worktree");
      await requireSuccessful(
        "npm",
        ["run", "build", "-w", "apps/connector", "--"],
        { cwd: sourceDirectory, inherit: true },
      );
      process.env.OVERTCHAT_CONNECTOR_BINARY = path.join(
        sourceDirectory,
        "apps",
        "connector",
        "dist",
        "overtchat-connector.mjs",
      );
    }
    preparation.message("Downloading the selected service images");
    await requireDocker(
      docker,
      [...composeArgs, "pull", "--ignore-pull-failures"],
      { inherit: true },
    );
  } else {
    preparation.message("Downloading the selected OvertChat components");
    await requireDocker(docker, [...composeArgs, "pull"], { inherit: true });
  }
  const snapshot = adopting && existing
    ? await (async () => {
        preparation.message("Creating and verifying a SQLite safety snapshot");
        return await createPreMigrationSnapshot(docker, existing, config);
      })()
    : null;
  preparation.stop(
    snapshot ? "Existing data snapshot created" : "OvertChat components ready",
  );
  if (snapshot) {
    note(snapshot.displayPath, "Pre-migration snapshot");
  }

  const progress = spinner();
  progress.start("Starting OvertChat");
  await requireDocker(docker, [...composeArgs, "up", "-d"], { inherit: true });
  progress.message("Waiting for OvertChat to become ready");
  await waitForApp(`http://127.0.0.1:${config.appPort}`);
  progress.message("Applying provider configuration");
  await syncCapabilities(config, secrets.managementSecret);
  if (config.agents.installed) {
    progress.message("Installing Agent Connections");
    await installManagedConnector(config, secrets.managementSecret);
  }
  await writeInstallationConfig(paths, config);
  progress.message("Reconciling bundled services");
  const reconciliation = await reconcileManagedSidecars(docker, config);
  progress.stop("OvertChat is ready");

  showSidecarReconciliation(reconciliation);

  outro(`Open: ${config.publicUrl}`);
}
