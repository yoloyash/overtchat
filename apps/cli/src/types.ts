export type SearchProvider = "bundled" | "brave" | "searxng" | "disabled";
export type TtsProvider = "bundled" | "openai-compatible" | "disabled";
export type SttProvider = "bundled" | "openai-compatible" | "disabled";
export type SpeechAccelerator = "auto" | "cpu" | "gpu";
export type KokoroGpuVariant = "standard" | "blackwell";

export type Gpu = {
  index: number;
  uuid: string;
  name: string;
  memoryMiB: number;
  computeCapability?: number;
};

export type SearchConfig = {
  provider: SearchProvider;
  bundledInstalled: boolean;
  baseUrl?: string;
  apiKey?: string;
};

export type TtsConfig = {
  provider: TtsProvider;
  bundledInstalled: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  voice?: string;
  accelerator?: SpeechAccelerator;
  gpuUuid?: string;
  gpuVariant?: KokoroGpuVariant;
};

export type SttConfig = {
  provider: SttProvider;
  bundledInstalled: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  accelerator?: SpeechAccelerator;
  gpuUuid?: string;
};

export type AgentConfig = {
  installed: boolean;
};

export type VoiceConfig = {
  installed: boolean;
};

export type InstallationConfig = {
  format: 1;
  appVersion: string;
  appImage: string;
  voiceVersion: string;
  voiceImage: string;
  connectorVersion: string;
  sttVersion: string;
  redisImage: string;
  searxngImage: string;
  kokoroImage: string;
  kokoroGpuImage: string;
  kokoroGpuBlackwellImage: string;
  appPort: number;
  bindAddress: string;
  publicUrl: string;
  extraTrustedOrigins: string[];
  connectorServerUrl: string;
  disableUpdateCheck?: boolean;
  composeProject: string;
  dataMountType: "volume" | "bind";
  dataVolume: string;
  search: SearchConfig;
  tts: TtsConfig;
  stt: SttConfig;
  voice: VoiceConfig;
  agents: AgentConfig;
  adoptedFrom?: string;
};

export type ExistingInstallation = {
  containerName: string;
  appVersion?: string;
  appImage?: string;
  composeProject: string;
  composeWorkingDir?: string;
  dataMountType: "volume" | "bind";
  dataVolume: string;
  appPort: number;
  bindAddress: string;
  publicUrl: string;
  environment: Map<string, string>;
  searxngConfigPath?: string;
  bundledServices: {
    search: boolean;
    tts: boolean;
    stt: boolean;
    voice?: boolean;
  };
  ttsAccelerator?: "cpu" | "gpu";
  ttsGpuUuid?: string;
  ttsGpuVariant?: KokoroGpuVariant;
  sttAccelerator?: "cpu" | "gpu";
  sttGpuUuid?: string;
};

export type RuntimePaths = {
  configDirectory: string;
  stateFile: string;
  secretsFile: string;
  stackDirectory: string;
  composeFile: string;
  searxngDirectory: string;
  searxngSettingsFile: string;
};
