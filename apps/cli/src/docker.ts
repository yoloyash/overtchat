import type {
  ExistingInstallation,
  Gpu,
  InstallationConfig,
} from "./types.js";
import { APP_IMAGE } from "./constants.js";
import { commandExists, requireSuccessful, runCommand } from "./process.js";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type DockerInspect = {
  Name?: string;
  Config?: {
    Env?: string[];
    Image?: string;
    Labels?: Record<string, string>;
  };
  Mounts?: Array<{
    Destination?: string;
    Name?: string;
    Source?: string;
    Type?: string;
  }>;
  NetworkSettings?: {
    Ports?: Record<
      string,
      Array<{ HostIp?: string; HostPort?: string }> | null
    >;
  };
  HostConfig?: {
    DeviceRequests?: Array<{ DeviceIDs?: string[] }>;
  };
};

type DockerVolumeInspect = {
  Name?: string;
  Labels?: Record<string, string>;
};

export type DockerCommand = {
  command: string;
  prefix: string[];
};

export async function detectDockerCommand(): Promise<DockerCommand | null> {
  if (!(await commandExists("docker"))) return null;
  const direct = await runCommand("docker", ["info"]);
  if (direct.exitCode === 0) return { command: "docker", prefix: [] };
  if (await commandExists("sudo")) {
    const elevated = await runCommand("sudo", ["-n", "docker", "info"]);
    if (elevated.exitCode === 0) {
      return { command: "sudo", prefix: ["docker"] };
    }
    return { command: "sudo", prefix: ["docker"] };
  }
  return { command: "docker", prefix: [] };
}

export async function installDockerEngine(): Promise<void> {
  const response = await fetch("https://get.docker.com", {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Docker's installer returned HTTP ${response.status}.`);
  }
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "overtchat-docker-"),
  );
  const installer = path.join(temporaryDirectory, "get-docker.sh");
  try {
    await writeFile(installer, new Uint8Array(await response.arrayBuffer()), {
      mode: 0o700,
    });
    await chmod(installer, 0o700);
    const elevated = process.getuid?.() === 0 ? [] : ["sudo"];
    await requireSuccessful(elevated[0] ?? "sh", [
      ...(elevated.length > 0 ? ["sh"] : []),
      installer,
    ], { inherit: true });
    const serviceCommand = elevated[0] ?? "systemctl";
    const serviceArgs = [
      ...(elevated.length > 0 ? ["systemctl"] : []),
      "enable",
      "--now",
      "docker",
    ];
    await requireSuccessful(serviceCommand, serviceArgs, { inherit: true });
    const user = process.env.SUDO_USER || os.userInfo().username;
    if (process.getuid?.() !== 0 && user && user !== "root") {
      await requireSuccessful("sudo", ["usermod", "-aG", "docker", user], {
        inherit: true,
      });
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function runElevated(
  command: string,
  args: string[],
  options: Parameters<typeof requireSuccessful>[2] = {},
) {
  if (process.getuid?.() === 0) {
    return await requireSuccessful(command, args, options);
  }
  if (!(await commandExists("sudo"))) {
    throw new Error(`Installing ${command} requires root access or sudo.`);
  }
  return await requireSuccessful("sudo", [command, ...args], options);
}

async function downloadText(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return await response.text();
}

function linuxDistribution(contents: string): "apt" | "dnf" | null {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/u)) {
    const match = /^([A-Z_]+)=(.*)$/u.exec(line);
    if (!match?.[1]) continue;
    values.set(match[1], (match[2] ?? "").replace(/^['"]|['"]$/gu, ""));
  }
  const names = `${values.get("ID") ?? ""} ${values.get("ID_LIKE") ?? ""}`;
  if (/\b(?:debian|ubuntu)\b/u.test(names)) return "apt";
  if (/\b(?:fedora|rhel|centos)\b/u.test(names)) return "dnf";
  return null;
}

export async function installNvidiaContainerToolkit(): Promise<void> {
  if (await commandExists("nvidia-ctk")) {
    await runElevated("nvidia-ctk", ["runtime", "configure", "--runtime=docker"], {
      inherit: true,
    });
    await runElevated("systemctl", ["restart", "docker"], { inherit: true });
    return;
  }
  const distribution = linuxDistribution(
    await readFile("/etc/os-release", "utf8").catch(() => ""),
  );
  if (!distribution) {
    throw new Error(
      "Automatic NVIDIA Container Toolkit installation supports Debian, Ubuntu, Fedora, RHEL, and CentOS.",
    );
  }
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "overtchat-nvidia-"),
  );
  try {
    if (distribution === "apt") {
      await runElevated(
        "apt-get",
        [
          "update",
        ],
        { inherit: true, environment: { ...process.env, DEBIAN_FRONTEND: "noninteractive" } },
      );
      await runElevated(
        "apt-get",
        [
          "install",
          "-y",
          "--no-install-recommends",
          "ca-certificates",
          "curl",
          "gnupg2",
        ],
        { inherit: true, environment: { ...process.env, DEBIAN_FRONTEND: "noninteractive" } },
      );
      const key = await downloadText(
        "https://nvidia.github.io/libnvidia-container/gpgkey",
      );
      const keyPath = path.join(temporaryDirectory, "nvidia-keyring.gpg");
      await requireSuccessful(
        "gpg",
        ["--dearmor", "--yes", "--output", keyPath],
        { input: key },
      );
      await runElevated("install", [
        "-m",
        "0644",
        keyPath,
        "/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg",
      ]);
      const repository = (
        await downloadText(
          "https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list",
        )
      ).replaceAll(
        "deb https://",
        "deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://",
      );
      const repositoryPath = path.join(
        temporaryDirectory,
        "nvidia-container-toolkit.list",
      );
      await writeFile(repositoryPath, repository, { mode: 0o644 });
      await runElevated("install", [
        "-m",
        "0644",
        repositoryPath,
        "/etc/apt/sources.list.d/nvidia-container-toolkit.list",
      ]);
      await runElevated("apt-get", ["update"], {
        inherit: true,
        environment: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
      });
      await runElevated("apt-get", ["install", "-y", "nvidia-container-toolkit"], {
        inherit: true,
        environment: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
      });
    } else {
      const repositoryPath = path.join(
        temporaryDirectory,
        "nvidia-container-toolkit.repo",
      );
      await writeFile(
        repositoryPath,
        await downloadText(
          "https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo",
        ),
        { mode: 0o644 },
      );
      await runElevated("install", [
        "-m",
        "0644",
        repositoryPath,
        "/etc/yum.repos.d/nvidia-container-toolkit.repo",
      ]);
      await runElevated("dnf", ["install", "-y", "nvidia-container-toolkit"], {
        inherit: true,
      });
    }
    await runElevated("nvidia-ctk", ["runtime", "configure", "--runtime=docker"], {
      inherit: true,
    });
    await runElevated("systemctl", ["restart", "docker"], { inherit: true });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function dockerComposeAvailable(
  docker: DockerCommand,
): Promise<boolean> {
  const result = await runDocker(docker, ["compose", "version"]);
  return result.exitCode === 0;
}

export async function runDocker(
  docker: DockerCommand,
  args: string[],
  options: Parameters<typeof runCommand>[2] = {},
) {
  return await runCommand(docker.command, [...docker.prefix, ...args], options);
}

export async function requireDocker(
  docker: DockerCommand,
  args: string[],
  options: Parameters<typeof requireSuccessful>[2] = {},
) {
  return await requireSuccessful(
    docker.command,
    [...docker.prefix, ...args],
    options,
  );
}

type ManagedSidecar = {
  containerName: string;
  label: string;
  selected: boolean;
  service: string;
};

export type SidecarReconciliation = {
  removed: string[];
  warnings: string[];
};

/**
 * Removes containers left behind when a managed Compose profile is no longer
 * selected. Docker Compose intentionally leaves inactive-profile containers
 * alone, so verify both Compose labels before touching an exact container name.
 */
export async function reconcileManagedSidecars(
  docker: DockerCommand,
  config: InstallationConfig,
): Promise<SidecarReconciliation> {
  const sidecars: ManagedSidecar[] = [
    {
      containerName: "overtchat-searxng",
      label: "SearXNG",
      selected: config.search.bundledInstalled,
      service: "searxng",
    },
    {
      containerName: "overtchat-kokoro",
      label: "Kokoro (CPU)",
      selected:
        config.tts.bundledInstalled &&
        config.tts.accelerator !== "auto" &&
        config.tts.accelerator !== "gpu",
      service: "kokoro",
    },
    {
      containerName: "overtchat-kokoro-gpu",
      label: "Kokoro (NVIDIA)",
      selected:
        config.tts.bundledInstalled &&
        (config.tts.accelerator === "auto" ||
          config.tts.accelerator === "gpu"),
      service: "kokoro-gpu",
    },
    {
      containerName: "overtchat-voice",
      label: "Realtime voice",
      selected: config.voice.installed,
      service: "voice",
    },
    {
      containerName: "overtchat-stt-cpu",
      label: "Parakeet (CPU)",
      selected:
        config.stt.bundledInstalled &&
        config.stt.accelerator !== "auto" &&
        config.stt.accelerator !== "gpu",
      service: "stt-cpu",
    },
    {
      containerName: "overtchat-stt-gpu",
      label: "Parakeet (NVIDIA)",
      selected:
        config.stt.bundledInstalled &&
        (config.stt.accelerator === "auto" ||
          config.stt.accelerator === "gpu"),
      service: "stt-gpu",
    },
  ];
  const result: SidecarReconciliation = { removed: [], warnings: [] };

  for (const sidecar of sidecars) {
    if (sidecar.selected) continue;
    let container: DockerInspect | null;
    try {
      container = await inspectContainer(docker, sidecar.containerName);
    } catch (error) {
      result.warnings.push(
        `Could not inspect ${sidecar.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (!container) continue;
    const labels = container.Config?.Labels;
    const inspectedName = (container.Name ?? "").replace(/^\//u, "");
    if (
      inspectedName !== sidecar.containerName ||
      labels?.["com.docker.compose.project"] !== config.composeProject ||
      labels?.["com.docker.compose.service"] !== sidecar.service
    ) {
      continue;
    }
    try {
      const removal = await runDocker(docker, [
        "container",
        "rm",
        "--force",
        sidecar.containerName,
      ]);
      if (removal.exitCode === 0) {
        result.removed.push(sidecar.label);
      } else {
        const detail = removal.stderr.trim() || removal.stdout.trim();
        result.warnings.push(
          `Could not remove ${sidecar.label}${detail ? `: ${detail}` : "."}`,
        );
      }
    } catch (error) {
      result.warnings.push(
        `Could not remove ${sidecar.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}

function environmentMap(values: string[] | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const value of values ?? []) {
    const separator = value.indexOf("=");
    if (separator < 1) continue;
    result.set(value.slice(0, separator), value.slice(separator + 1));
  }
  return result;
}

async function inspectContainer(
  docker: DockerCommand,
  name: string,
): Promise<DockerInspect | null> {
  const result = await runDocker(docker, ["inspect", name]);
  if (result.exitCode !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as DockerInspect[];
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

function kokoroGpuVariant(
  container: DockerInspect | null,
): "standard" | "blackwell" | undefined {
  if (!container) return undefined;
  return container.Config?.Labels?.["com.overtchat.tts.gpu-variant"] ===
    "blackwell"
    ? "blackwell"
    : "standard";
}

async function stoppedComposeInstallation(
  docker: DockerCommand,
): Promise<ExistingInstallation | null> {
  const volumes = await runDocker(docker, [
    "volume",
    "ls",
    "--filter",
    "label=com.docker.compose.volume=overtchat-data",
    "--format",
    "{{.Name}}",
  ]);
  if (volumes.exitCode !== 0) return null;
  const candidates = volumes.stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    throw new Error(
      "More than one stopped OvertChat data volume was found. Start the installation you want to adopt, then run overtchat setup again.",
    );
  }
  const inspected = await runDocker(docker, ["volume", "inspect", candidates[0]!]);
  if (inspected.exitCode !== 0) return null;
  let volume: DockerVolumeInspect | undefined;
  try {
    volume = (JSON.parse(inspected.stdout) as DockerVolumeInspect[])[0];
  } catch {
    return null;
  }
  const project = volume?.Labels?.["com.docker.compose.project"] || "overtchat";
  const redis = await inspectContainer(docker, "overtchat-redis");
  const searxng = await inspectContainer(docker, "overtchat-searxng");
  const kokoro = await inspectContainer(docker, "overtchat-kokoro");
  const kokoroGpu = await inspectContainer(docker, "overtchat-kokoro-gpu");
  const voice = await inspectContainer(docker, "overtchat-voice");
  const sttGpu = await inspectContainer(docker, "overtchat-stt-gpu");
  const sttCpu = sttGpu
    ? null
    : await inspectContainer(docker, "overtchat-stt-cpu");
  const labels = redis?.Config?.Labels ?? searxng?.Config?.Labels ?? {};
  return {
    containerName: "overtchat-app",
    composeProject: project,
    composeWorkingDir: labels["com.docker.compose.project.working_dir"],
    dataMountType: "volume",
    dataVolume: candidates[0]!,
    appPort: 4718,
    bindAddress: "0.0.0.0",
    publicUrl: "http://localhost:4718",
    environment: new Map(),
    searxngConfigPath: searxng?.Mounts?.find(
      (mount) => mount.Destination === "/etc/searxng",
    )?.Source,
    bundledServices: {
      search: Boolean(searxng),
      tts: Boolean(kokoroGpu ?? kokoro),
      stt: Boolean(sttGpu ?? sttCpu),
      voice: Boolean(voice),
    },
    ttsAccelerator: kokoroGpu ? "gpu" : kokoro ? "cpu" : undefined,
    ttsGpuUuid: kokoroGpu?.HostConfig?.DeviceRequests?.[0]?.DeviceIDs?.[0],
    ttsGpuVariant: kokoroGpuVariant(kokoroGpu),
    sttAccelerator: sttGpu ? "gpu" : sttCpu ? "cpu" : undefined,
    sttGpuUuid: sttGpu?.HostConfig?.DeviceRequests?.[0]?.DeviceIDs?.[0],
  };
}

export async function detectExistingInstallation(
  docker: DockerCommand,
): Promise<ExistingInstallation | null> {
  const app = await inspectContainer(docker, "overtchat-app");
  if (!app) return await stoppedComposeInstallation(docker);
  const environment = environmentMap(app.Config?.Env);
  const imageMatch = new RegExp(
    `^${APP_IMAGE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:(\\d+\\.\\d+\\.\\d+)$`,
    "u",
  ).exec(app.Config?.Image ?? "");
  const dataMount = app.Mounts?.find(
    (mount) => mount.Destination === "/app/data",
  );
  const dataVolume = dataMount?.Name ?? dataMount?.Source;
  if (!dataVolume) {
    throw new Error(
      "The existing overtchat-app container has no recognizable /app/data mount.",
    );
  }
  const labels = app.Config?.Labels ?? {};
  const portValue =
    app.NetworkSettings?.Ports?.["4717/tcp"]?.[0]?.HostPort ?? "4718";
  const bindAddress =
    app.NetworkSettings?.Ports?.["4717/tcp"]?.[0]?.HostIp || "0.0.0.0";
  const appPort = Number(portValue);
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65_535) {
    throw new Error(`The existing OvertChat port is invalid: ${portValue}`);
  }

  const searxng = await inspectContainer(docker, "overtchat-searxng");
  const kokoro = await inspectContainer(docker, "overtchat-kokoro");
  const kokoroGpu = await inspectContainer(docker, "overtchat-kokoro-gpu");
  const voice = await inspectContainer(docker, "overtchat-voice");
  const searxngConfigPath = searxng?.Mounts?.find(
    (mount) => mount.Destination === "/etc/searxng",
  )?.Source;
  const sttGpu = await inspectContainer(docker, "overtchat-stt-gpu");
  const sttCpu = sttGpu
    ? null
    : await inspectContainer(docker, "overtchat-stt-cpu");

  return {
    containerName: (app.Name ?? "/overtchat-app").replace(/^\//u, ""),
    appVersion: imageMatch?.[1],
    appImage: imageMatch?.[0],
    composeProject: labels["com.docker.compose.project"] || "overtchat",
    composeWorkingDir: labels["com.docker.compose.project.working_dir"],
    dataMountType: dataMount?.Type === "bind" ? "bind" : "volume",
    dataVolume,
    appPort,
    bindAddress,
    publicUrl:
      environment.get("BETTER_AUTH_URL") || `http://localhost:${appPort}`,
    environment,
    searxngConfigPath,
    bundledServices: {
      search: Boolean(searxng),
      tts: Boolean(kokoroGpu ?? kokoro),
      stt: Boolean(sttGpu ?? sttCpu),
      voice: Boolean(voice),
    },
    ttsAccelerator: kokoroGpu ? "gpu" : kokoro ? "cpu" : undefined,
    ttsGpuUuid: kokoroGpu?.HostConfig?.DeviceRequests?.[0]?.DeviceIDs?.[0],
    ttsGpuVariant:
      environment.get("TTS_GPU_VARIANT") === "blackwell"
        ? "blackwell"
        : kokoroGpuVariant(kokoroGpu),
    sttAccelerator: sttGpu ? "gpu" : sttCpu ? "cpu" : undefined,
    sttGpuUuid: sttGpu?.HostConfig?.DeviceRequests?.[0]?.DeviceIDs?.[0],
  };
}

export async function detectNvidiaGpus(): Promise<Gpu[]> {
  if (!(await commandExists("nvidia-smi"))) return [];
  let result = await runCommand("nvidia-smi", [
    "--query-gpu=index,uuid,name,memory.total,compute_cap",
    "--format=csv,noheader,nounits",
  ]);
  // Older drivers do not expose compute_cap as a query field. Keep GPU
  // acceleration available; only Blackwell auto-detection is lost.
  if (result.exitCode !== 0) {
    result = await runCommand("nvidia-smi", [
      "--query-gpu=index,uuid,name,memory.total",
      "--format=csv,noheader,nounits",
    ]);
  }
  if (result.exitCode !== 0) return [];
  return parseNvidiaSmi(result.stdout);
}

export function parseNvidiaSmi(output: string): Gpu[] {
  const gpus: Gpu[] = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const [rawIndex, rawUuid, rawName, rawMemory, rawComputeCapability] = line
      .split(",")
      .map((value) => value.trim());
    const index = Number(rawIndex);
    const memoryMiB = Number(rawMemory);
    if (
      !Number.isInteger(index) ||
      !rawUuid ||
      !rawName ||
      !Number.isFinite(memoryMiB)
    ) {
      continue;
    }
    const computeCapability = Number(rawComputeCapability);
    gpus.push({
      index,
      uuid: rawUuid,
      name: rawName,
      memoryMiB,
      ...(Number.isFinite(computeCapability) ? { computeCapability } : {}),
    });
  }
  return gpus;
}

export async function nvidiaContainerRuntimeAvailable(
  docker: DockerCommand,
): Promise<boolean> {
  const result = await runDocker(docker, [
    "info",
    "--format",
    "{{json .Runtimes}}",
  ]);
  if (result.exitCode !== 0) return false;
  try {
    const runtimes = JSON.parse(result.stdout) as Record<string, unknown>;
    return Object.hasOwn(runtimes, "nvidia");
  } catch {
    return false;
  }
}
