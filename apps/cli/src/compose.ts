import type { InstallationConfig, RuntimePaths } from "./types.js";
import type { InstallationSecrets } from "./config.js";

function envValue(value: string): string {
  if (/[\r\n\0]/u.test(value)) {
    throw new Error("Configuration values cannot contain line breaks.");
  }
  return JSON.stringify(value.replaceAll("$", "$$"));
}

function composeBindAddress(value: string): string {
  return value.includes(":") && !value.startsWith("[") ? `[${value}]` : value;
}

function profileList(config: InstallationConfig): string[] {
  const profiles: string[] = [];
  if (config.search.bundledInstalled) profiles.push("search-bundled");
  if (config.tts.bundledInstalled) profiles.push("tts-bundled");
  if (config.stt.bundledInstalled) {
    profiles.push(config.stt.accelerator === "cpu" ? "stt-cpu" : "stt-gpu");
  }
  if (config.voice.installed) profiles.push("voice");
  return profiles;
}

function capabilityUrl(
  provider: string,
  bundledUrl: string,
  configuredUrl?: string,
): string {
  if (provider === "bundled") return bundledUrl;
  if (provider === "disabled") return "";
  return configuredUrl ?? "";
}

export function renderStackEnvironment(
  config: InstallationConfig,
  secrets: InstallationSecrets,
  paths: RuntimePaths,
): string {
  const trustedOrigins = [
    config.publicUrl,
    `http://localhost:${config.appPort}`,
    `http://127.0.0.1:${config.appPort}`,
    ...config.extraTrustedOrigins,
  ].filter((value, index, values) => values.indexOf(value) === index);
  const values: Array<[string, string | number]> = [
    ["APP_VERSION", config.appVersion],
    ["OVERTCHAT_APP_IMAGE", config.appImage],
    ["VOICE_VERSION", config.voiceVersion],
    ["OVERTCHAT_VOICE_IMAGE", config.voiceImage],
    ["STT_VERSION", config.sttVersion],
    ["OVERTCHAT_REDIS_IMAGE", config.redisImage],
    ["OVERTCHAT_SEARXNG_IMAGE", config.searxngImage],
    ["OVERTCHAT_KOKORO_IMAGE", config.kokoroImage],
    ["APP_PORT", config.appPort],
    ["APP_BIND_ADDRESS", composeBindAddress(config.bindAddress)],
    ["BETTER_AUTH_URL", config.publicUrl],
    ["EXTRA_TRUSTED_ORIGINS", trustedOrigins.join(",")],
    ["HOST_CONNECTOR_URL", config.connectorServerUrl],
    ["DISABLE_UPDATE_CHECK", String(config.disableUpdateCheck ?? false)],
    ["BETTER_AUTH_SECRET", secrets.betterAuthSecret],
    ["OVERTCHAT_MANAGEMENT_SECRET", secrets.managementSecret],
    ["SEARXNG_SECRET", secrets.searxngSecret],
    ["VOICE_SHARED_SECRET", secrets.voiceSharedSecret],
    ["COMPOSE_PROJECT_NAME", config.composeProject],
    ["OVERTCHAT_CONTAINER_PREFIX", "overtchat"],
    ["COMPOSE_PROFILES", profileList(config).join(",")],
    ["OVERTCHAT_DATA_SOURCE", config.dataVolume],
    ["SEARXNG_CONFIG_DIR", paths.searxngDirectory],
    [
      "OVERTCHAT_INSTALLED_CAPABILITIES",
      [
        ...(config.search.bundledInstalled ? ["search"] : []),
        ...(config.tts.bundledInstalled ? ["tts"] : []),
        ...(config.stt.bundledInstalled ? ["stt"] : []),
        ...(config.voice.installed ? ["voice"] : []),
        ...(config.agents.installed ? ["agents"] : []),
      ].join(","),
    ],
    ["WEB_SEARCH_PROVIDER", config.search.provider],
    [
      "OVERTCHAT_SEARXNG_URL",
      capabilityUrl(
        config.search.provider,
        "http://searxng:8080",
        config.search.baseUrl,
      ),
    ],
    ["TTS_PROVIDER", config.tts.provider],
    [
      "OVERTCHAT_TTS_URL",
      capabilityUrl(
        config.tts.provider,
        "http://kokoro:8880",
        config.tts.baseUrl,
      ),
    ],
    ["TTS_MODEL", config.tts.model ?? "kokoro"],
    ["TTS_VOICE", config.tts.voice ?? "af_heart"],
    ["STT_PROVIDER", config.stt.provider],
    [
      "OVERTCHAT_STT_URL",
      capabilityUrl(
        config.stt.provider,
        "http://stt:5092",
        config.stt.baseUrl,
      ),
    ],
    ["STT_MODEL", config.stt.model ?? "parakeet-tdt-0.6b-v3"],
    ["STT_GPU_DEVICE_ID", config.stt.gpuUuid ?? "0"],
  ];
  return `${values
    .map(([key, value]) => `${key}=${envValue(String(value))}`)
    .join("\n")}\n`;
}

export function renderComposeFile(config: InstallationConfig): string {
  const appDataMount =
    config.dataMountType === "bind"
      ? `      - type: bind
        source: \${OVERTCHAT_DATA_SOURCE}
        target: /app/data`
      : `      - overtchat-data:/app/data`;
  const appDataVolume =
    config.dataMountType === "bind"
      ? ""
      : `  overtchat-data:
    name: \${OVERTCHAT_DATA_SOURCE}
    external: true
`;
  return `name: \${COMPOSE_PROJECT_NAME:-overtchat}

services:
  app:
    image: \${OVERTCHAT_APP_IMAGE}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-app
    restart: unless-stopped
    ports:
      - "\${APP_BIND_ADDRESS}:\${APP_PORT}:4717"
    environment:
      BETTER_AUTH_SECRET: \${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: \${BETTER_AUTH_URL}
      EXTRA_TRUSTED_ORIGINS: \${EXTRA_TRUSTED_ORIGINS:-}
      HOST_CONNECTOR_URL: \${HOST_CONNECTOR_URL}
      DISABLE_UPDATE_CHECK: \${DISABLE_UPDATE_CHECK:-false}
      OVERTCHAT_MANAGEMENT_SECRET: \${OVERTCHAT_MANAGEMENT_SECRET}
      OVERTCHAT_INSTALLED_CAPABILITIES: \${OVERTCHAT_INSTALLED_CAPABILITIES:-}
      VOICE_SHARED_SECRET: \${VOICE_SHARED_SECRET}
      WEB_SEARCH_PROVIDER: \${WEB_SEARCH_PROVIDER}
      SEARXNG_URL: \${OVERTCHAT_SEARXNG_URL:-}
      TTS_PROVIDER: \${TTS_PROVIDER}
      KOKORO_URL: \${OVERTCHAT_TTS_URL:-}
      TTS_MODEL: \${TTS_MODEL:-kokoro}
      TTS_VOICE: \${TTS_VOICE:-af_heart}
      STT_PROVIDER: \${STT_PROVIDER}
      STT_URL: \${OVERTCHAT_STT_URL:-}
      STT_MODEL: \${STT_MODEL:-parakeet-tdt-0.6b-v3}
      DATABASE_URL: /app/data/chat.db
      REDIS_URL: redis://redis:6379
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
${appDataMount}
      - overtchat-npm-cache:/app/npm-cache
    depends_on:
      redis:
        condition: service_healthy
      searxng:
        condition: service_healthy
        required: false
      kokoro:
        condition: service_healthy
        required: false

  voice:
    image: \${OVERTCHAT_VOICE_IMAGE}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-voice
    restart: unless-stopped
    profiles: [voice]
    environment:
      VOICE_SHARED_SECRET: \${VOICE_SHARED_SECRET}
    depends_on:
      app:
        condition: service_started

  redis:
    image: \${OVERTCHAT_REDIS_IMAGE}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-redis
    restart: unless-stopped
    command: [redis-server, --save, "", --appendonly, "no", --maxmemory, 64mb, --maxmemory-policy, allkeys-lru]
    healthcheck:
      test: [CMD, redis-cli, ping]
      interval: 10s
      timeout: 3s
      retries: 5

  searxng:
    image: \${OVERTCHAT_SEARXNG_IMAGE}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-searxng
    restart: unless-stopped
    profiles: [search-bundled]
    environment:
      FORCE_OWNERSHIP: "false"
      SEARXNG_SECRET: \${SEARXNG_SECRET}
    volumes:
      - \${SEARXNG_CONFIG_DIR}:/etc/searxng:rw
    healthcheck:
      test: [CMD-SHELL, "wget -q --spider http://localhost:8080/healthz || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 10
      start_period: 10s

  kokoro:
    image: \${OVERTCHAT_KOKORO_IMAGE}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-kokoro
    restart: unless-stopped
    profiles: [tts-bundled]
    healthcheck:
      test:
        - CMD-SHELL
        - python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8880/health').status==200 else 1)"
      interval: 15s
      timeout: 5s
      retries: 20
      start_period: 60s

  stt-cpu:
    image: ghcr.io/yoloyash/overtchat-stt-cpu:\${STT_VERSION}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-stt-cpu
    restart: unless-stopped
    profiles: [stt-cpu]
    networks:
      default:
        aliases: [stt]
    volumes:
      - overtchat-stt-models:/models

  stt-gpu:
    image: ghcr.io/yoloyash/overtchat-stt-gpu:\${STT_VERSION}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-stt-gpu
    restart: unless-stopped
    profiles: [stt-gpu]
    networks:
      default:
        aliases: [stt]
    volumes:
      - overtchat-stt-models:/models
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids: ["\${STT_GPU_DEVICE_ID}"]
              capabilities: [gpu]

volumes:
${appDataVolume}  overtchat-npm-cache:
  overtchat-stt-models:
    name: overtchat-stt-models
`;
}

export const SEARXNG_SETTINGS = `use_default_settings: true

server:
  bind_address: 0.0.0.0
  port: 8080
  secret_key: "\${SEARXNG_SECRET}"
  limiter: false
  public_instance: false
  image_proxy: true

search:
  safe_search: 0
  formats:
    - html
    - json

ui:
  static_use_hash: true

outgoing:
  request_timeout: 4.0
  max_request_timeout: 10.0
  pool_connections: 100
  pool_maxsize: 20

engines:
  - name: brave
    disabled: true
`;
