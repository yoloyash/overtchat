import type { ComponentType } from "react";
import { CalendarLogo } from "@/components/CalendarLogo";
import { GmailLogo } from "@/components/GmailLogo";
import type { IntegrationId } from "@/lib/integrations/schema";

/** How each integration is named and drawn in Settings. */
export const INTEGRATION_DISPLAY: Record<
  IntegrationId,
  {
    name: string;
    Logo: ComponentType<{ className?: string }>;
    description: string;
    /** What turning on "Use in every chat" costs, and what happens otherwise. */
    everyChat: string;
  }
> = {
  gmail: {
    name: "Gmail",
    Logo: GmailLogo,
    description:
      "Let models search, read and organize your mail, and write drafts for you to send.",
    everyChat:
      "Loads the mail skill into every chat from the start, which adds about 1,100 tokens to each request. When off, models load it when a message needs your mail, or when you type /gmail in a chat.",
  },
  calendar: {
    name: "Google Calendar",
    Logo: CalendarLogo,
    description:
      "Let models check your schedule and add, change or delete events.",
    everyChat:
      "Loads the calendar skill into every chat from the start, which adds about 900 tokens to each request. When off, models load it when a message needs your schedule, or when you type /calendar in a chat.",
  },
};

/** "Gmail", "Gmail and Google Calendar". */
export function integrationNames(ids: readonly IntegrationId[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(
    ids.map((id) => INTEGRATION_DISPLAY[id].name),
  );
}
