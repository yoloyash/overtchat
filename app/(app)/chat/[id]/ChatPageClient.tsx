"use client";

import type { UIMessage } from "ai";
import { ChatArea } from "@/components/ChatArea";
import { useAppShell } from "@/components/AppShell";

interface Props {
  chatId: string;
  initialMessages: UIMessage[];
}

export function ChatPageClient({ chatId, initialMessages }: Props) {
  const { config, setConfig } = useAppShell();
  return (
    <ChatArea
      chatId={chatId}
      initialMessages={initialMessages}
      config={config}
      onConfigChange={setConfig}
    />
  );
}
