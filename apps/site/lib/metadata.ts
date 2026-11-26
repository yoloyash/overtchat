import type { Metadata } from "next";
import { absoluteSiteUrl } from "./site";

export const SITE_NAME = "overtchat";
export const DEFAULT_SITE_TITLE =
  "overtchat — your AI chat, actually yours";
export const DEFAULT_SITE_DESCRIPTION =
  "A polished, privacy-first Open WebUI alternative for local and hosted models, with multi-user accounts, realtime local voice, files, search, memory, and desktop and mobile apps.";

// One card for every page: the homepage hero. Pages that set `openGraph`
// replace inherited images, so the card is listed here instead of as a file.
const SOCIAL_IMAGE = {
  url: absoluteSiteUrl("/og.png"),
  width: 1200,
  height: 630,
  alt: "The OvertChat headline, “Your AI chat. Actually yours.”, beside the app showing an interactive answer with summary figures, a line chart and follow-up questions",
};

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
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [SOCIAL_IMAGE],
    },
  };
}
