"use client";

import { Server } from "lucide-react";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import type { AvailableMcpServer } from "@/lib/mcp/schema";
import {
  useAvailableMcpServers,
  useSetMcpServerPreference,
} from "@/lib/queries/mcpServers";
import { SettingsSection } from "../_components/SettingsRows";

export function AvailableMcpServersPanel() {
  const { data: servers = [] } = useAvailableMcpServers();
  const setPreference = useSetMcpServerPreference();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function toggle(server: AvailableMcpServer, enabled: boolean) {
    setTogglingId(server.id);
    try {
      await setPreference.mutateAsync({ id: server.id, enabled });
    } catch (error) {
      toast.error({
        title: `Failed to ${enabled ? "enable" : "disable"} MCP server`,
        description: getErrorMessage(error, "Your preference was not changed."),
      });
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <SettingsSection
      title="MCP servers"
      description="Choose which available MCP servers can provide tools in your chats."
    >
      {servers.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No MCP servers are available to you.
          </p>
        </div>
      ) : (
        servers.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between gap-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30">
                <Server className="size-4" />
              </div>
              <p className="truncate text-sm font-medium">{server.name}</p>
            </div>
            <Switch
              checked={server.enabled}
              disabled={togglingId === server.id}
              onCheckedChange={(enabled) => void toggle(server, enabled)}
              aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name} for my chats`}
            />
          </div>
        ))
      )}
    </SettingsSection>
  );
}
