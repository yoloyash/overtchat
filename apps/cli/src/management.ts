import { readFile } from "node:fs/promises";
import {
  appleSpeechCapabilities,
  appleSpeechHealth,
  appleSpeechToken,
} from "./apple-speech.js";
import { readInstallationConfig, readInstallationSecrets } from "./config.js";
import { CLI_VERSION } from "./constants.js";
import {
  detectDockerCommand,
  runDocker,
  type DockerCommand,
} from "./docker.js";
import { runtimePaths } from "./paths.js";
import type { InstallationConfig, RuntimePaths } from "./types.js";

export type Component = {
  id: string;
  service?: string;
  configured: string;
  state: string;
  running?: string;
  image?: string;
};
export function components(config: InstallationConfig): Component[] {
  const result: Component[] = [
    {
      id: "app",
      service: "app",
      configured: config.appVersion,
      image: config.appImage,
      state: "unknown",
    },
    {
      id: "redis",
      service: "redis",
      configured: config.redisImage,
      image: config.redisImage,
      state: "unknown",
    },
  ];
  if (config.search.bundledInstalled)
    result.push({
      id: "search",
      service: "searxng",
      configured: config.searxngImage,
      image: config.searxngImage,
      state: "unknown",
    });
  for (const id of ["tts", "stt"] as const) {
    const selection = config[id];
    if (!selection.bundledInstalled || selection.accelerator === "apple")
      continue;
    const gpu =
      selection.accelerator === "auto" || selection.accelerator === "gpu";
    const service =
      id === "tts"
        ? gpu
          ? "kokoro-gpu"
          : "kokoro"
        : gpu
          ? "stt-gpu"
          : "stt-cpu";
    const image =
      id === "tts"
        ? gpu
          ? config.tts.gpuVariant === "blackwell"
            ? config.kokoroGpuBlackwellImage
            : config.kokoroGpuImage
          : config.kokoroImage
        : `ghcr.io/yoloyash/overtchat-${service}:${config.sttVersion}`;
    result.push({
      id,
      service,
      configured: id === "stt" ? config.sttVersion : image,
      image,
      state: "unknown",
    });
  }
  if (config.voice.installed)
    result.push({
      id: "voice",
      service: "voice",
      configured: config.voiceVersion,
      image: config.voiceImage,
      state: "unknown",
    });
  if (config.agents.installed)
    result.push({
      id: "connector",
      configured: config.connectorVersion,
      state: "unknown",
    });
  if (appleSpeechCapabilities(config).length)
    result.push({ id: "speech", configured: "Apple speech", state: "unknown" });
  return result;
}

export const composeServices = [
  "app",
  "redis",
  "searxng",
  "kokoro",
  "kokoro-gpu",
  "stt-cpu",
  "stt-gpu",
  "voice",
];
export function composeArgs(paths: RuntimePaths): string[] {
  return ["compose", "--env-file", paths.secretsFile, "-f", paths.composeFile];
}
export async function managedInstallation() {
  const paths = runtimePaths();
  const config = await readInstallationConfig(paths);
  if (!config)
    throw new Error("OvertChat is not managed yet. Run overtchat setup first.");
  return { paths, config };
}
export async function managedDocker(): Promise<DockerCommand> {
  const docker = await detectDockerCommand(true);
  if (!docker)
    throw new Error(
      "Docker is unavailable. Start Docker and check your Docker permissions, then retry.",
    );
  const info = await runDocker(docker, ["info"], { timeoutMs: 10_000 });
  if (info.exitCode)
    throw new Error(
      "Docker is unavailable. Start Docker and check your Docker permissions, then retry.",
    );
  return docker;
}

export type Container = {
  Id: string;
  Name: string;
  State: { Status: string; Health?: { Status: string } };
  Config: { Image: string; Labels?: Record<string, string> };
  Mounts?: Array<{
    Type: string;
    Name?: string;
    Source: string;
    Destination: string;
  }>;
};
export async function projectContainers(
  docker: DockerCommand,
  config: InstallationConfig,
): Promise<Container[]> {
  const list = await runDocker(
    docker,
    [
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${config.composeProject}`,
    ],
    { timeoutMs: 10_000 },
  );
  if (list.exitCode)
    throw new Error(
      "Could not list OvertChat containers. Check Docker permissions.",
    );
  const ids = list.stdout.trim().split(/\s+/u).filter(Boolean);
  if (!ids.length) return [];
  const inspected = await runDocker(docker, ["inspect", ...ids], {
    timeoutMs: 10_000,
  });
  if (inspected.exitCode)
    throw new Error(
      "Could not inspect OvertChat containers. Retry after Docker settles.",
    );
  return JSON.parse(inspected.stdout) as Container[];
}
export function ownedContainer(
  container: Container,
  config: InstallationConfig,
  paths: RuntimePaths,
): boolean {
  const labels = container.Config.Labels ?? {};
  return (
    labels["com.docker.compose.project"] === config.composeProject &&
    composeServices.includes(labels["com.docker.compose.service"] ?? "") &&
    labels["com.docker.compose.project.working_dir"] === paths.stackDirectory
  );
}

export async function localJson(
  config: InstallationConfig,
  endpoint: string,
  secret?: string,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${config.appPort}${endpoint}`,
      {
        redirect: "error",
        signal: AbortSignal.timeout(3000),
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      },
    );
    return response.ok
      ? ((await response.json()) as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
export async function installationReport() {
  const paths = runtimePaths();
  const config = await readInstallationConfig(paths);
  const report = {
    cli: CLI_VERSION,
    managed: !!config,
    url: config?.publicUrl,
    access: config?.access?.mode,
    storage: config
      ? {
          type: config.dataMountType,
          source: config.dataVolume,
          config: paths.configDirectory,
          stack: paths.stackDirectory,
        }
      : undefined,
    providers: config
      ? {
          search: config.search.provider,
          tts: config.tts.provider,
          stt: config.stt.provider,
        }
      : undefined,
    components: config ? components(config) : [],
    problems: [] as string[],
  };
  if (!config) return report;
  let containers: Container[] = [];
  try {
    containers = await projectContainers(await managedDocker(), config);
  } catch (error) {
    report.problems.push(
      error instanceof Error ? error.message : String(error),
    );
  }
  for (const component of report.components.filter((entry) => entry.service)) {
    const container = containers.find(
      (entry) =>
        entry.Config.Labels?.["com.docker.compose.service"] ===
          component.service && ownedContainer(entry, config, paths),
    );
    component.state = container
      ? container.State.Status === "running"
        ? (container.State.Health?.Status ?? "running")
        : container.State.Status
      : "unavailable";
    if (container?.State.Status === "running")
      component.running = container.Config.Image;
    if (container && container.Config.Image !== component.image)
      report.problems.push(
        `${component.id}: running image differs from saved configuration. Run overtchat update to reconcile.`,
      );
  }
  const ping = await localJson(config, "/api/ping");
  const app = report.components.find((entry) => entry.id === "app")!;
  const identified =
    ping?.ok === true &&
    ping.name === "overtchat" &&
    (!config.instanceId || ping.instanceId === config.instanceId);
  if (identified) {
    app.state = "ready";
    if (typeof ping.version === "string") app.running = ping.version;
    if (app.running !== app.configured)
      report.problems.push(
        "App version differs from saved configuration. Run overtchat update to reconcile.",
      );
  } else if (app.state === "running" || app.state === "healthy")
    app.state = "not ready";
  const secrets = await readInstallationSecrets(paths);
  const connector = report.components.find((entry) => entry.id === "connector");
  if (connector) {
    const response =
      identified && secrets.managementSecret
        ? await localJson(
            config,
            "/api/internal/management/connector",
            secrets.managementSecret,
          )
        : null;
    const value = response?.connector as
      | { online?: boolean; version?: string }
      | undefined;
    connector.state = value?.online ? "online" : "offline";
    if (value?.online && typeof value.version === "string")
      connector.running = value.version;
  }
  const speech = report.components.find((entry) => entry.id === "speech");
  if (speech) {
    const health = secrets.managementSecret
      ? await appleSpeechHealth(
          config,
          appleSpeechToken(secrets.managementSecret),
        )
      : null;
    speech.state = health ? "ready" : "unavailable";
    speech.running = health?.revision;
  }
  return report;
}

export async function optionalFile(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
