import type { ComponentType } from "react";
import { GmailLogo } from "@/components/GmailLogo";
import type { IntegrationId } from "@/lib/integrations/schema";

/** How each integration is named and drawn in Settings. */
export const INTEGRATION_DISPLAY: Record<
  IntegrationId,
  {
    name: string;
    Logo: ComponentType<{ className?: string }>;
    description: string;
    /** What turning on "Use in every chat" costs, and the alternative. */
    everyChat: string;
  }
> = {
  gmail: {
    name: "Gmail",
    Logo: GmailLogo,
    description:
      "Let models search, read and organize your mail, and write drafts for you to send.",
    everyChat:
      "Offers the mail tools in every chat, which adds about 1,100 tokens to each request. When off, type /gmail in a chat to use your mail there.",
  },
};

/** "Gmail", "Gmail and Google Calendar". */
export function integrationNames(ids: readonly IntegrationId[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(
    ids.map((id) => INTEGRATION_DISPLAY[id].name),
  );
}
