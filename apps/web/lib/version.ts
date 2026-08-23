import installManifest from "../../site/public/install-manifest.json";

/**
 * The install manifest is the release source of truth used by compose, the
 * installer, and the marketing site. An explicit public value can identify a
 * custom build without requiring a second version file.
 */
export const APP_VERSION =
  process.env.NEXT_PUBLIC_OVERTCHAT_VERSION?.trim() ||
  installManifest.appVersion;
