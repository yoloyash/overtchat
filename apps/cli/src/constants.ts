export const CLI_VERSION = "0.6.0";

export const APP_IMAGE = "ghcr.io/yoloyash/overtchat-app";
export const VOICE_IMAGE = "ghcr.io/yoloyash/overtchat-voice";
export const SANDBOX_IMAGES = {
  slim: "ghcr.io/yoloyash/overtchat-sandbox",
  full: "ghcr.io/yoloyash/overtchat-sandbox-full",
} as const;
export const CONNECTOR_REPOSITORY = "yoloyash/overtchat";
export const RELEASE_MANIFEST_URL =
  "https://overtchat.com/install-manifest.json";

export const DEFAULT_APP_PORT = 4718;
export const DEFAULT_COMPOSE_PROJECT = "overtchat";
export const DEFAULT_DATA_VOLUME = "overtchat-data";
