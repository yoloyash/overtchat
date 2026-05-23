import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "overtchat",
    short_name: "overtchat",
    description: "Simple self-hosted chat UI for OpenAI-compatible endpoints",
    start_url: "/",
    display: "standalone",
    background_color: "#23261f",
    theme_color: "#23261f",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
