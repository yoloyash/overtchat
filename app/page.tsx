"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { ApiConfigModal } from "@/components/ApiConfigModal";
import { type ApiConfig, loadConfig } from "@/lib/config";

export default function Home() {
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState<ApiConfig>({ baseUrl: "", apiKey: "", model: "" });
  const [chatKey, setChatKey] = useState(0);

  useEffect(() => {
    setConfig(loadConfig());
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        onOpenConfig={() => setConfigOpen(true)}
        onNewChat={() => setChatKey((k) => k + 1)}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        <ChatArea
          key={chatKey}
          config={config}
          onOpenConfig={() => setConfigOpen(true)}
        />
      </main>
      <ApiConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onSave={(next) => setConfig(next)}
      />
    </div>
  );
}
