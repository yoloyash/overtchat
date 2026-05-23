import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },
  transpilePackages: ["@overtchat/shared"],
};

export default nextConfig;
