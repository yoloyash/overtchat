const fs = require("node:fs");
const path = require("node:path");

// EAS file variables provide a path; local builds can use an ignored file.
// Builds without Firebase config remain usable, but cannot register Android push.
module.exports = ({ config }) => {
  const localFile = path.join(__dirname, "google-services.json");
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ??
    (fs.existsSync(localFile) ? localFile : undefined);
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
