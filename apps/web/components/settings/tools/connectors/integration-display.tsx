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
    /** What each tool access choice does: always available, or on demand. */
    toolAccess: string;
  }
> = {
  gmail: {
    name: "Gmail",
    Logo: GmailLogo,
    description:
      "Let models search, read and organize your mail, and write drafts for you to send.",
    toolAccess:
      "Always available loads the mail skill into every chat from the start, which adds about 1,100 tokens to each request. On demand loads it when a message needs your mail, or when you type /gmail in a chat.",
  },
  calendar: {
    name: "Google Calendar",
    Logo: CalendarLogo,
    description:
      "Let models check your schedule and add, change or delete events.",
    toolAccess:
      "Always available loads the calendar skill into every chat from the start, which adds about 900 tokens to each request. On demand loads it when a message needs your schedule, or when you type /calendar in a chat.",
  },
};

/** "Gmail", "Gmail and Google Calendar". */
export function integrationNames(ids: readonly IntegrationId[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(
    ids.map((id) => INTEGRATION_DISPLAY[id].name),
  );
}
