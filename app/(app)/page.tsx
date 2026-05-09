"use client";

import { ChatArea } from "@/components/ChatArea";
import { useAppShell } from "@/components/AppShell";

export default function Home() {
  const { config, setConfig } = useAppShell();
  return <ChatArea config={config} onConfigChange={setConfig} />;
}
