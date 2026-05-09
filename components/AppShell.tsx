"use client";

import { createContext, useContext, useMemo } from "react";
import { type ApiConfig, useConfig } from "@/lib/config";

interface ShellContext {
  config: ApiConfig;
  setConfig: (config: ApiConfig) => void;
}

const Ctx = createContext<ShellContext | null>(null);

export function useAppShell() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppShell must be used inside <AppShell>");
  return ctx;
}

export function AppShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [config, setConfig] = useConfig();

  const value = useMemo<ShellContext>(
    () => ({ config, setConfig }),
    [config, setConfig],
  );

  return (
    <Ctx.Provider value={value}>
      <div className="flex h-screen overflow-hidden bg-background">
        {sidebar}
        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </Ctx.Provider>
  );
}
