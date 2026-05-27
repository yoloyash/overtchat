// Sentry-aware Metro config. getSentryExpoConfig wraps the default
// Expo metro config so source maps are emitted in the format Sentry's
// EAS build hook expects.
// https://docs.sentry.io/platforms/react-native/manual-setup/expo/

const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);
