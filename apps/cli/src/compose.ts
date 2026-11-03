import { usesAppleSpeech, bundledSpeechUrl, appleSpeechToken, appleSpeechCapabilities } from "./apple-speech.js";
import { SANDBOX_IMAGES } from "./constants.js";
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
  if (config.tts.bundledInstalled && !usesAppleSpeech(config.tts)) {
    profiles.push(
      config.tts.accelerator === "auto" || config.tts.accelerator === "gpu"
        ? "tts-gpu"
        : "tts-cpu",
    );
  }
  if (config.stt.bundledInstalled && !usesAppleSpeech(config.stt)) {
    profiles.push(
      config.stt.accelerator === "auto" || config.stt.accelerator === "gpu"
        ? "stt-gpu"
        : "stt-cpu",
    );
  }
  if (config.voice.installed) profiles.push("voice");
  if (config.sandbox.installed) {
    profiles.push(config.sandbox.tier === "full" ? "sandbox-full" : "sandbox");
  }
  if (config.access?.mode === "cloud" && config.access.cloud) profiles.push("cloud");
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

function cloudEnvironment(
  config: InstallationConfig,
  secrets: InstallationSecrets,
): Array<[string, string | number]> {
  const cloud = config.access?.mode === "cloud" ? config.access.cloud : undefined;
  return [
    ["OVERTCHAT_CLOUD_HOSTNAME", cloud?.hostname ?? ""],
    ["OVERTCHAT_CLOUD_NAME", cloud?.hostname.split(".")[0] ?? ""],
    ["OVERTCHAT_CLOUD_RELAY_HOST", cloud?.relayHost ?? ""],
    ["OVERTCHAT_CLOUD_RELAY_PORT", cloud?.relayPort ?? ""],
    ["OVERTCHAT_CLOUD_RELAY_SERVER_NAME", cloud?.relayServerName ?? ""],
    ["OVERTCHAT_CLOUD_CREDENTIAL", cloud ? secrets.cloudCredential : ""],
    // A public address makes administrator accounts reachable from anywhere.
    ["OVERTCHAT_REQUIRE_ADMIN_TWO_FACTOR", cloud ? "true" : "false"],
  ];
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
    ["SANDBOX_VERSION", config.sandboxVersion],
    ["OVERTCHAT_REDIS_IMAGE", config.redisImage],
    ["OVERTCHAT_SEARXNG_IMAGE", config.searxngImage],
    ["OVERTCHAT_KOKORO_IMAGE", config.kokoroImage],
    [
      "OVERTCHAT_KOKORO_GPU_IMAGE",
      config.tts.gpuVariant === "blackwell"
        ? config.kokoroGpuBlackwellImage
        : config.kokoroGpuImage,
    ],
    ["APP_PORT", config.appPort],
    ["OVERTCHAT_INSTANCE_ID", config.instanceId ?? ""],
    ["APP_BIND_ADDRESS", composeBindAddress(config.bindAddress)],
    ["BETTER_AUTH_URL", config.publicUrl],
    ["EXTRA_TRUSTED_ORIGINS", trustedOrigins.join(",")],
    ["HOST_CONNECTOR_URL", config.connectorServerUrl],
    ["DISABLE_UPDATE_CHECK", String(config.disableUpdateCheck ?? false)],
    ["BETTER_AUTH_SECRET", secrets.betterAuthSecret],
    ["OVERTCHAT_MANAGEMENT_SECRET", secrets.managementSecret],
    ["SEARXNG_SECRET", secrets.searxngSecret],
    ["VOICE_SHARED_SECRET", secrets.voiceSharedSecret],
    ["SANDBOX_TOKEN", secrets.sandboxToken],
    ["OVERTCHAT_SANDBOX_URL", config.sandbox.installed ? "http://sandbox:8080" : ""],
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
    ["OVERTCHAT_BUNDLED_TTS_URL", bundledSpeechUrl(config, "tts")],
    ["OVERTCHAT_BUNDLED_STT_URL", bundledSpeechUrl(config, "stt")],
    ["OVERTCHAT_BUNDLED_SPEECH_TOKEN", appleSpeechCapabilities(config).length ? appleSpeechToken(secrets.managementSecret) : ""],
    ["TTS_PROVIDER", config.tts.provider],
    [
      "OVERTCHAT_TTS_URL",
      capabilityUrl(
        config.tts.provider,
        bundledSpeechUrl(config, "tts"),
        config.tts.baseUrl,
      ),
    ],
    ["TTS_MODEL", config.tts.model ?? "kokoro"],
    ["TTS_VOICE", config.tts.voice ?? "af_heart"],
    ["TTS_GPU_DEVICE_ID", config.tts.gpuUuid ?? "0"],
    ["TTS_GPU_VARIANT", config.tts.gpuVariant ?? "standard"],
    ["STT_PROVIDER", config.stt.provider],
    [
      "OVERTCHAT_STT_URL",
      capabilityUrl(
        config.stt.provider,
        bundledSpeechUrl(config, "stt"),
        config.stt.baseUrl,
      ),
    ],
    ["STT_MODEL", config.stt.model ?? "parakeet-tdt-0.6b-v3"],
    ["STT_GPU_DEVICE_ID", config.stt.gpuUuid ?? "0"],
    ["OVERTCHAT_CLOUD_TUNNEL_IMAGE", config.cloudTunnelImage],
    ["OVERTCHAT_CLOUD_PROXY_IMAGE", config.cloudProxyImage],
    ["OVERTCHAT_CLOUD_DIR", paths.cloudDirectory],
    ...cloudEnvironment(config, secrets),
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
      OVERTCHAT_INSTANCE_ID: \${OVERTCHAT_INSTANCE_ID:-}
      EXTRA_TRUSTED_ORIGINS: \${EXTRA_TRUSTED_ORIGINS:-}
      HOST_CONNECTOR_URL: \${HOST_CONNECTOR_URL}
      DISABLE_UPDATE_CHECK: \${DISABLE_UPDATE_CHECK:-false}
      OVERTCHAT_REQUIRE_ADMIN_TWO_FACTOR: \${OVERTCHAT_REQUIRE_ADMIN_TWO_FACTOR:-false}
      OVERTCHAT_MANAGEMENT_SECRET: \${OVERTCHAT_MANAGEMENT_SECRET}
      OVERTCHAT_INSTALLED_CAPABILITIES: \${OVERTCHAT_INSTALLED_CAPABILITIES:-}
      VOICE_SHARED_SECRET: \${VOICE_SHARED_SECRET}
      WEB_SEARCH_PROVIDER: \${WEB_SEARCH_PROVIDER}
      SEARXNG_URL: \${OVERTCHAT_SEARXNG_URL:-}
      OVERTCHAT_BUNDLED_TTS_URL: \${OVERTCHAT_BUNDLED_TTS_URL:-}
      OVERTCHAT_BUNDLED_STT_URL: \${OVERTCHAT_BUNDLED_STT_URL:-}
      OVERTCHAT_BUNDLED_SPEECH_TOKEN: \${OVERTCHAT_BUNDLED_SPEECH_TOKEN:-}
      TTS_PROVIDER: \${TTS_PROVIDER}
      KOKORO_URL: \${OVERTCHAT_TTS_URL:-}
      TTS_MODEL: \${TTS_MODEL:-kokoro}
      TTS_VOICE: \${TTS_VOICE:-af_heart}
      TTS_GPU_VARIANT: \${TTS_GPU_VARIANT:-standard}
      STT_PROVIDER: \${STT_PROVIDER}
      STT_URL: \${OVERTCHAT_STT_URL:-}
      STT_MODEL: \${STT_MODEL:-parakeet-tdt-0.6b-v3}
      SANDBOX_URL: \${OVERTCHAT_SANDBOX_URL:-}
      SANDBOX_TOKEN: \${SANDBOX_TOKEN:-}
      DATABASE_URL: /app/data/chat.db
      REDIS_URL: redis://redis:6379
    extra_hosts:
      - "host.docker.internal:host-gateway"
    networks: [default, sandbox]
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
      kokoro-gpu:
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
    profiles: [tts-cpu]
    labels:
      com.overtchat.tts.accelerator: cpu
    healthcheck:
      test:
        - CMD-SHELL
        - python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8880/health').status==200 else 1)"
      interval: 15s
      timeout: 5s
      retries: 20
      start_period: 60s

  kokoro-gpu:
    image: \${OVERTCHAT_KOKORO_GPU_IMAGE}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-kokoro-gpu
    restart: unless-stopped
    profiles: [tts-gpu]
    labels:
      com.overtchat.tts.accelerator: gpu
      com.overtchat.tts.gpu-variant: \${TTS_GPU_VARIANT:-standard}
    networks:
      default:
        aliases: [kokoro]
    healthcheck:
      test:
        - CMD-SHELL
        - python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8880/health').status==200 else 1)"
      interval: 15s
      timeout: 5s
      retries: 20
      start_period: 60s
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids: ["\${TTS_GPU_DEVICE_ID}"]
              capabilities: [gpu]

  # OvertChat Cloud: the tunnel forwards visitor TLS from the relay, unopened,
  # to the proxy, which holds this installation's certificate.
  cloud-tunnel:
    image: \${OVERTCHAT_CLOUD_TUNNEL_IMAGE}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-cloud-tunnel
    restart: unless-stopped
    profiles: [cloud]
    command: [-c, /etc/overtchat-cloud/frpc.toml]
    environment:
      OVERTCHAT_CLOUD_NAME: \${OVERTCHAT_CLOUD_NAME:-}
      OVERTCHAT_CLOUD_CREDENTIAL: \${OVERTCHAT_CLOUD_CREDENTIAL:-}
      OVERTCHAT_CLOUD_RELAY_HOST: \${OVERTCHAT_CLOUD_RELAY_HOST:-}
      OVERTCHAT_CLOUD_RELAY_PORT: \${OVERTCHAT_CLOUD_RELAY_PORT:-}
      OVERTCHAT_CLOUD_RELAY_SERVER_NAME: \${OVERTCHAT_CLOUD_RELAY_SERVER_NAME:-}
    volumes:
      - \${OVERTCHAT_CLOUD_DIR}:/etc/overtchat-cloud:ro

  cloud-proxy:
    image: \${OVERTCHAT_CLOUD_PROXY_IMAGE}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-cloud-proxy
    restart: unless-stopped
    profiles: [cloud]
    environment:
      OVERTCHAT_CLOUD_HOSTNAME: \${OVERTCHAT_CLOUD_HOSTNAME:-}
    volumes:
      - \${OVERTCHAT_CLOUD_DIR}/Caddyfile:/etc/caddy/Caddyfile:ro
      - overtchat-cloud-certificates:/data
    # Start after the tunnel so the first certificate challenge can reach it.
    depends_on:
      cloud-tunnel:
        condition: service_started
      app:
        condition: service_started

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

  # Code execution. Each run is a fresh unprivileged user, so the container
  # needs these capabilities; it has no volumes, secrets or internet access.
  sandbox: &sandbox
    image: ${SANDBOX_IMAGES.slim}:\${SANDBOX_VERSION}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-sandbox
    restart: unless-stopped
    profiles: [sandbox]
    init: true
    read_only: true
    tmpfs:
      - /runs:size=2g,mode=0711
      - /tmp:size=256m
    cap_drop: [ALL]
    cap_add: [SETUID, SETGID, CHOWN, DAC_OVERRIDE, FOWNER, KILL]
    security_opt: ["no-new-privileges:true"]
    pids_limit: 512
    mem_limit: 6g
    environment:
      SANDBOX_TOKEN: \${SANDBOX_TOKEN}
    networks:
      sandbox:
        aliases: [sandbox]

  sandbox-full:
    <<: *sandbox
    image: ${SANDBOX_IMAGES.full}:\${SANDBOX_VERSION}
    container_name: \${OVERTCHAT_CONTAINER_PREFIX:-overtchat}-sandbox-full
    profiles: [sandbox-full]

networks:
  # Shared only by the app and the sandbox, with no route to the internet.
  sandbox:
    internal: true

volumes:
${appDataVolume}  overtchat-npm-cache:
  overtchat-cloud-certificates:
  overtchat-stt-models:
    name: overtchat-stt-models
`;
}

// frpc and Caddy read the installation's values from their environment, so
// these files only change with the OvertChat release.
export const CLOUD_TUNNEL_CONFIG = `# Managed by overtchat setup: connects this installation to OvertChat Cloud.
serverAddr = "{{ .Envs.OVERTCHAT_CLOUD_RELAY_HOST }}"
serverPort = {{ .Envs.OVERTCHAT_CLOUD_RELAY_PORT }}
loginFailExit = false
# Required by frp; the relay authorizes the credential below instead.
auth.token = "overtchat"
# The relay requires the user to be this installation's name.
user = "{{ .Envs.OVERTCHAT_CLOUD_NAME }}"
metadatas.credential = "{{ .Envs.OVERTCHAT_CLOUD_CREDENTIAL }}"

# frp turns heartbeats off when multiplexing; the relay rejects them to
# disconnect a server that was unlinked, which frees its name.
transport.heartbeatInterval = 30

# The tunnel shares the relay's HTTPS port and pins the relay's own CA.
transport.tls.disableCustomTLSFirstByte = false
transport.tls.trustedCaFile = "/etc/overtchat-cloud/relay-ca.pem"
transport.tls.serverName = "{{ .Envs.OVERTCHAT_CLOUD_RELAY_SERVER_NAME }}"

[[proxies]]
name = "overtchat"
type = "https"
subdomain = "{{ .Envs.OVERTCHAT_CLOUD_NAME }}"
localIP = "cloud-proxy"
localPort = 443
transport.proxyProtocolVersion = "v2"
`;

export const CLOUD_PROXY_CONFIG = `# Managed by overtchat setup: HTTPS for OvertChat Cloud visitors.
{
	auto_https disable_redirects
	servers {
		listener_wrappers {
			# Only the tunnel reaches this port. It sends each visitor's address in a
			# PROXY header, which Caddy passes on as X-Forwarded-For.
			proxy_protocol {
				allow 0.0.0.0/0 ::/0
			}
			tls
		}
	}
}

https://{$OVERTCHAT_CLOUD_HOSTNAME} {
	# The certificate is issued through the relay with TLS-ALPN-01.
	tls {
		issuer acme {
			# Set only by tests, to use a staging or local ACME server.
			dir {$OVERTCHAT_CLOUD_ACME_DIRECTORY:https://acme-v02.api.letsencrypt.org/directory}
			disable_http_challenge
		}
	}
	reverse_proxy app:4717
}
`;

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
