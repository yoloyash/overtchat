import type { Metadata } from "next";
import { absoluteSiteUrl } from "./site";

export const SITE_NAME = "overtchat";
export const DEFAULT_SITE_TITLE =
  "overtchat — chat you actually own";
export const DEFAULT_SITE_DESCRIPTION =
  "A complete, self-hosted chat client for hosted and local language models. One Docker command brings up the whole stack, and your chat history is stored on your server.";

export function createPageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  absoluteTitle?: boolean;
}): Metadata {
  const url = absoluteSiteUrl(path);
  const socialTitle = absoluteTitle ? title : `${title} — ${SITE_NAME}`;

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: socialTitle,
      description,
      url,
    },
    twitter: {
      card: "summary",
      title: socialTitle,
      description,
    },
  };
}
