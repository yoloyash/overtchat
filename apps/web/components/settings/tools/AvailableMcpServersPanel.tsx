"use client";

import { Server } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import type { AvailableMcpServer } from "@/lib/mcp/schema";
import {
  useAvailableMcpServers,
  useSetMcpServerPreference,
} from "@/lib/queries/mcpServers";
import {
  SettingsEmptyState,
  SettingsNotice,
  SettingsSection,
} from "../SettingsRows";

export function AvailableMcpServersPanel() {
  const { t } = useTranslation();
  const { data: servers = [], isPending, error } = useAvailableMcpServers();
  const setPreference = useSetMcpServerPreference();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function toggle(server: AvailableMcpServer, enabled: boolean) {
    setTogglingId(server.id);
    try {
      await setPreference.mutateAsync({ id: server.id, enabled });
    } catch (error) {
      toast.error({
        title: enabled
          ? t("tools.mcp.available.enableErrorTitle")
          : t("tools.mcp.available.disableErrorTitle"),
        description: getErrorMessage(
          error,
          t("tools.mcp.available.toggleErrorFallback"),
        ),
      });
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <SettingsSection
      title={t("tools.mcp.available.title")}
      description={t("tools.mcp.available.description")}
    >
      {isPending ? (
        <SettingsNotice className="py-6">
          {t("tools.mcp.available.loading")}
        </SettingsNotice>
      ) : error ? (
        <SettingsNotice tone="error" className="py-6">
          {getErrorMessage(error, t("tools.mcp.available.loadError"))}
        </SettingsNotice>
      ) : servers.length === 0 ? (
        <SettingsEmptyState
          title={t("tools.mcp.available.emptyTitle")}
          description={t("tools.mcp.available.emptyDescription")}
        />
      ) : (
        servers.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between gap-4 py-4"
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
              aria-label={
                server.enabled
                  ? t("tools.mcp.available.disableLabel", { name: server.name })
                  : t("tools.mcp.available.enableLabel", { name: server.name })
              }
            />
          </div>
        ))
      )}
    </SettingsSection>
  );
}
