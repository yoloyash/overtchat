import type { MetadataRoute } from "next";
import { sitePath } from "@/lib/site";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "overtchat",
    short_name: "overtchat",
    description: "A lightweight self-hosted chat client.",
    start_url: sitePath("/"),
    scope: sitePath("/"),
    display: "standalone",
    background_color: "#f8f8f3",
    theme_color: "#171c16",
    icons: [
      {
        src: sitePath("/icon.svg"),
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
