import {
  conversationUsesCalendar,
  conversationUsesGmail,
} from "@overtchat/shared";
import type { ComponentType } from "react";
import { CalendarLogo } from "@/components/CalendarLogo";
import { GmailLogo } from "@/components/GmailLogo";
import type { IntegrationId } from "@/lib/integrations/schema";

/** A connected account's tools, as a chat can turn them on. */
export interface ChatConnector {
  id: IntegrationId;
  /** Also the slash command that turns it on. */
  name: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string[];
  /** Whether a conversation already has it on, which then stays. */
  usedIn: typeof conversationUsesGmail;
}

export const CHAT_CONNECTORS: readonly ChatConnector[] = [
  {
    id: "gmail",
    name: "gmail",
    title: "Gmail",
    description: "Use your mail in this chat",
    icon: GmailLogo,
    keywords: ["mail", "email", "inbox"],
    usedIn: conversationUsesGmail,
  },
  {
    id: "calendar",
    name: "calendar",
    title: "Google Calendar",
    description: "Use your calendar in this chat",
    icon: CalendarLogo,
    keywords: ["schedule", "events", "meeting", "agenda"],
    usedIn: conversationUsesCalendar,
  },
];

/** One connector as the composer shows it for the open chat. */
export interface ComposerConnector extends ChatConnector {
  /** Whether this chat's next message is offered its tools. */
  active: boolean;
  /** On in every chat by the user's setting, so nothing marks this one. */
  ambient: boolean;
  /** Why it cannot be switched here. It still shows whether it is on. */
  lockedReason?: string;
}
