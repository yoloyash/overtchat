// Sentry-aware Metro config. getSentryExpoConfig wraps the default
// Expo metro config so source maps are emitted in the format Sentry's
// EAS build hook expects.
// https://docs.sentry.io/platforms/react-native/manual-setup/expo/

const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // The realtime SDK exposes browser and Node shims. Native supplies its own
  // WebSocket/audio; select the web-safe shims instead of Node's ws/crypto.
  const scoped = moduleName.startsWith("@openai/agents")
    ? { ...context, unstable_conditionNames: ["browser", "import"] }
    : context;
  return resolveRequest
    ? resolveRequest(scoped, moduleName, platform)
    : scoped.resolveRequest(scoped, moduleName, platform);
};
module.exports = config;
