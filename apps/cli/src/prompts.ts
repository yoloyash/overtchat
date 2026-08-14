import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  password,
  select,
  text,
} from "@clack/prompts";
import { commandExists } from "./process.js";
import type {
  ExistingInstallation,
  Gpu,
  InstallationConfig,
  SearchProvider,
  SttProvider,
  TtsProvider,
} from "./types.js";

function chosen<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Setup cancelled. Nothing was changed.");
    process.exit(130);
  }
  return value;
}

function urlValidation(value: string | undefined): string | undefined {
  if (!value?.trim()) return "Enter the API base URL.";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Use an http:// or https:// URL.";
    }
  } catch {
    return "Enter a valid URL.";
  }
  return undefined;
}

async function promptSearch(
  current: InstallationConfig["search"],
): Promise<InstallationConfig["search"]> {
  const provider = chosen(
    await select<SearchProvider>({
      message: "Web search",
      initialValue: current.provider,
      options: [
        {
          value: "bundled",
          label: "Bundled SearXNG",
          hint: "private and runs on this server",
        },
        { value: "brave", label: "Brave Search API" },
        { value: "searxng", label: "Existing SearXNG" },
        { value: "disabled", label: "Disabled" },
      ],
    }),
  );
  if (provider === "brave") {
    const hasCurrentKey = Boolean(current.apiKey);
    const apiKey = chosen(
      await password({
        message: hasCurrentKey
          ? "Brave Search API key (leave blank to keep current)"
          : "Brave Search API key",
        mask: "•",
        validate: (value) =>
          value?.trim() || hasCurrentKey
            ? undefined
            : "Enter your Brave Search API key.",
      }),
    );
    return {
      provider,
      bundledInstalled: current.bundledInstalled,
      apiKey: apiKey.trim() || current.apiKey,
    };
  }
  if (provider === "searxng") {
    const baseUrl = chosen(
      await text({
        message: "Existing SearXNG URL",
        placeholder: "http://host.docker.internal:8088",
        initialValue: current.baseUrl,
        validate: urlValidation,
      }),
    );
    return {
      provider,
      bundledInstalled: current.bundledInstalled,
      baseUrl: baseUrl.trim().replace(/\/$/u, ""),
    };
  }
  return {
    provider,
    bundledInstalled: current.bundledInstalled || provider === "bundled",
  };
}

async function promptTts(
  current: InstallationConfig["tts"],
): Promise<InstallationConfig["tts"]> {
  const provider = chosen(
    await select<TtsProvider>({
      message: "Text-to-speech",
      initialValue: current.provider,
      options: [
        {
          value: "bundled",
          label: "Bundled Kokoro",
          hint: "local CPU service",
        },
        { value: "openai-compatible", label: "OpenAI-compatible API" },
        { value: "disabled", label: "Disabled" },
      ],
    }),
  );
  if (provider !== "openai-compatible") {
    return {
      provider,
      bundledInstalled: current.bundledInstalled || provider === "bundled",
    };
  }
  const baseUrl = chosen(
    await text({
      message: "TTS API base URL",
      placeholder: "https://api.openai.com/v1",
      initialValue: current.baseUrl,
      validate: urlValidation,
    }),
  );
  const apiKey = chosen(
    await password({
      message: current.apiKey
        ? "TTS API key (leave blank to keep current)"
        : "TTS API key (leave blank when not required)",
      mask: "•",
    }),
  );
  const model = chosen(
    await text({
      message: "TTS model",
      initialValue: current.model ?? "tts-1",
      validate: (value) => (value?.trim() ? undefined : "Enter a model name."),
    }),
  );
  const voice = chosen(
    await text({
      message: "Default voice",
      initialValue: current.voice ?? "alloy",
      validate: (value) => (value?.trim() ? undefined : "Enter a voice."),
    }),
  );
  return {
    provider,
    bundledInstalled: current.bundledInstalled,
    baseUrl: baseUrl.trim().replace(/\/$/u, ""),
    apiKey: apiKey.trim() || current.apiKey || "",
    model: model.trim(),
    voice: voice.trim(),
  };
}

function gpuLabel(gpu: Gpu): string {
  const memoryGiB = Math.round((gpu.memoryMiB / 1024) * 10) / 10;
  return `GPU ${gpu.index} — ${gpu.name}, ${memoryGiB} GB`;
}

export function existingInstallationSummary(
  existing: ExistingInstallation,
): string {
  const storage =
    existing.dataMountType === "volume"
      ? `Docker volume ${existing.dataVolume}`
      : `Bind mount ${existing.dataVolume}`;
  const services = [
    ...(existing.bundledServices.search ? ["SearXNG"] : []),
    ...(existing.bundledServices.tts ? ["Kokoro"] : []),
    ...(existing.bundledServices.stt
      ? [
          existing.sttAccelerator === "gpu"
            ? "Parakeet (NVIDIA)"
            : "Parakeet (CPU)",
        ]
      : []),
  ];
  return [
    `Version: ${existing.appVersion ?? "unknown"}`,
    `Address: ${existing.publicUrl}`,
    `Published port: ${existing.bindAddress}:${existing.appPort}`,
    `Data: ${storage}`,
    ...(existing.composeWorkingDir
      ? [`Compose directory: ${existing.composeWorkingDir}`]
      : []),
    `Bundled services: ${services.length > 0 ? services.join(", ") : "none detected"}`,
    "",
    "This storage will be reused. A verified SQLite snapshot will be created before the app is replaced or migrations run.",
  ].join("\n");
}

async function promptStt(
  current: InstallationConfig["stt"],
  gpus: Gpu[],
): Promise<InstallationConfig["stt"]> {
  const provider = chosen(
    await select<SttProvider>({
      message: "Speech-to-text",
      initialValue: current.provider,
      options: [
        {
          value: "bundled",
          label:
            gpus.length > 0
              ? "Bundled Parakeet — NVIDIA accelerated"
              : "Bundled Parakeet — CPU",
          hint: gpus.length > 0 ? `${gpus.length} NVIDIA GPU${gpus.length === 1 ? "" : "s"} detected` : "CPU",
        },
        { value: "openai-compatible", label: "OpenAI-compatible API" },
        { value: "disabled", label: "Disabled" },
      ],
    }),
  );
  if (provider === "openai-compatible") {
    const baseUrl = chosen(
      await text({
        message: "STT API base URL",
        placeholder: "https://api.openai.com/v1",
        initialValue: current.baseUrl,
        validate: urlValidation,
      }),
    );
    const apiKey = chosen(
      await password({
        message: current.apiKey
          ? "STT API key (leave blank to keep current)"
          : "STT API key (leave blank when not required)",
        mask: "•",
      }),
    );
    const model = chosen(
      await text({
        message: "STT model",
        initialValue: current.model ?? "whisper-1",
        validate: (value) => (value?.trim() ? undefined : "Enter a model name."),
      }),
    );
    return {
      provider,
      bundledInstalled: current.bundledInstalled,
      baseUrl: baseUrl.trim().replace(/\/$/u, ""),
      apiKey: apiKey.trim() || current.apiKey || "",
      model: model.trim(),
    };
  }
  if (provider === "disabled") {
    return { provider, bundledInstalled: current.bundledInstalled };
  }
  if (gpus.length === 0) {
    note("No NVIDIA GPU was detected. Parakeet will use the CPU image.", "Local STT accelerator");
    return { provider, bundledInstalled: true, accelerator: "cpu" };
  }
  const autoGpu = [...gpus].sort((left, right) => right.memoryMiB - left.memoryMiB)[0];
  const currentSelection =
    current.accelerator === "cpu"
      ? "cpu"
      : current.accelerator === "gpu" && current.gpuUuid
        ? `gpu:${current.gpuUuid}`
        : "auto";
  const accelerator = chosen(
    await select<string>({
      message: "Local STT accelerator",
      initialValue: currentSelection,
      options: [
        {
          value: "auto",
          label: `Auto — ${autoGpu?.name ?? gpus[0]?.name}`,
          hint: "recommended",
        },
        ...gpus.map((gpu) => ({
          value: `gpu:${gpu.uuid}`,
          label: gpuLabel(gpu),
        })),
        { value: "cpu", label: "CPU" },
      ],
    }),
  );
  if (accelerator === "cpu") {
    return { provider, bundledInstalled: true, accelerator: "cpu" };
  }
  if (accelerator === "auto") {
    return {
      provider,
      bundledInstalled: true,
      accelerator: "auto",
      gpuUuid: autoGpu?.uuid ?? gpus[0]?.uuid,
    };
  }
  return {
    provider,
    bundledInstalled: true,
    accelerator: "gpu",
    gpuUuid: accelerator.slice("gpu:".length),
  };
}

async function detectedAgents(): Promise<string[]> {
  const agents = [
    ["codex", "Codex"],
    ["pi", "Pi"],
    ["omp", "Oh My Pi"],
  ] as const;
  const detected: string[] = [];
  for (const [command, label] of agents) {
    if (await commandExists(command)) detected.push(label);
  }
  return detected;
}

export async function promptInstallationConfig(
  initial: InstallationConfig,
  gpus: Gpu[],
  existing?: ExistingInstallation,
): Promise<InstallationConfig> {
  intro("OvertChat setup");
  if (existing) {
    note(existingInstallationSummary(existing), "Existing installation found");
    const adopt = chosen(
      await confirm({
        message: "Adopt this installation and preserve its data?",
        initialValue: true,
        active: "Continue",
        inactive: "Cancel",
      }),
    );
    if (!adopt) {
      cancel("Setup cancelled. Nothing was changed.");
      process.exit(0);
    }
  }
  const search = await promptSearch(initial.search);
  const tts = await promptTts(initial.tts);
  const stt = await promptStt(initial.stt, gpus);
  const agents = await detectedAgents();
  note(
    [
      "Use OvertChat as a client for coding agents such as Codex, Pi, and Oh My Pi.",
      ...(agents.length > 0
        ? [`Detected on this machine: ${agents.join(", ")}`]
        : []),
    ].join("\n"),
    "Agent Connections",
  );
  const installAgents = chosen(
    await confirm({
      message: "Install Agent Connections?",
      initialValue: initial.agents.installed || agents.length > 0,
      active: "Yes",
      inactive: "No",
    }),
  );
  return {
    ...initial,
    search,
    tts,
    stt,
    agents: { installed: installAgents },
  };
}
