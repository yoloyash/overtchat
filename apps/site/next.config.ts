import type { NextConfig } from "next";

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const basePath = rawBasePath === "/" ? "" : rawBasePath.replace(/\/$/, "");

if (basePath && !basePath.startsWith("/")) {
  throw new Error("NEXT_PUBLIC_BASE_PATH must be empty or begin with a slash");
}

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@overtchat/shared"],
};

export default nextConfig;
