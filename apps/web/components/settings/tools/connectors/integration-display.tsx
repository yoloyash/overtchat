import type { ComponentType } from "react";
import { i18n } from "@overtchat/shared/i18n";
import { CalendarLogo } from "@/components/CalendarLogo";
import { GmailLogo } from "@/components/GmailLogo";
import type { IntegrationId } from "@/lib/integrations/schema";

/** How each integration is named and drawn in Settings. */
export const INTEGRATION_DISPLAY: Record<
  IntegrationId,
  {
    name: string;
    Logo: ComponentType<{ className?: string }>;
  }
> = {
  gmail: {
    name: "Gmail",
    Logo: GmailLogo,
  },
  calendar: {
    name: "Google Calendar",
    Logo: CalendarLogo,
  },
};

/** "Gmail", "Gmail and Google Calendar". */
export function integrationNames(ids: readonly IntegrationId[]): string {
  return new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(
    ids.map((id) => INTEGRATION_DISPLAY[id].name),
  );
}
