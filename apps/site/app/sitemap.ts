import type { MetadataRoute } from "next";
import { absoluteSiteUrl } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteSiteUrl("/"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteSiteUrl("/releases/"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: absoluteSiteUrl("/privacy/"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
