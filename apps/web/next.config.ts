import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  outputFileTracingIncludes: {
    "/*": [
      "./drizzle/**/*",
      "./lib/providers/server/model-catalog.NOTICE",
      "./lib/providers/server/model-catalog.manifest.json",
    ],
  },
  transpilePackages: ["@overtchat/agent-bridge", "@overtchat/shared"],
  // Hosts allowed to load `next dev` assets cross-origin. Only used in dev
  // (Next.js ignores this at build time). Phone-on-LAN testing needs the
  // host's LAN IP listed here.
  allowedDevOrigins: ["10.0.0.200", "10.0.0.26"],
  async headers() {
    return [
      {
        // The Python runtime is loaded by an opaque-origin iframe so generated
        // code cannot inherit the authenticated OvertChat origin.
        source: "/pyodide/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
