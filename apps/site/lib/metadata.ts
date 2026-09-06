import type { Metadata } from "next";
import { absoluteSiteUrl } from "./site";

export const SITE_NAME = "overtchat";
export const DEFAULT_SITE_TITLE =
  "overtchat — your AI chat, actually yours";
export const DEFAULT_SITE_DESCRIPTION =
  "A polished, privacy-first Open WebUI alternative for local and hosted models, with multi-user accounts, realtime local voice, files, search, memory, and mobile.";

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
