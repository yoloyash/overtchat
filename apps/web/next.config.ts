import path from "node:path";
import type { NextConfig } from "next";

const voiceOrigin = (process.env.VOICE_URL ?? "http://voice:8765").replace(
  /\/$/,
  "",
);

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ws"],
  env: { OVERTCHAT_TERMINAL_RELAY_PORT: process.env.OVERTCHAT_TERMINAL_RELAY_PORT ?? "14717" },
  outputFileTracingRoot: path.join(__dirname, "../../"),
  outputFileTracingIncludes: {
    "/*": [
      "./drizzle/**/*",
      "./lib/providers/server/model-catalog.NOTICE",
      "./lib/providers/server/model-catalog.manifest.json",
    ],
  },
  outputFileTracingExcludes: {
    "/*": ["./data/**/*"],
  },
  transpilePackages: ["@overtchat/agent-bridge", "@overtchat/shared", "@overtchat/voice-client"],
  // Hosts allowed to load `next dev` assets cross-origin. Only used in dev
  // (Next.js ignores this at build time). Phone-on-LAN testing needs the
  // host's LAN IP listed here.
  allowedDevOrigins: ["10.0.0.200", "10.0.0.26"],
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/agent-terminals/socket",
          destination: `http://127.0.0.1:${process.env.OVERTCHAT_TERMINAL_RELAY_PORT ?? "14717"}/api/agent-terminals/socket`,
        },
        {
          source: "/api/voice/realtime",
          destination: `${voiceOrigin}/v1/realtime`,
        },
      ],
    };
  },
};

export default nextConfig;
