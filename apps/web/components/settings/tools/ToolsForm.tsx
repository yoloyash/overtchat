"use client";

import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_WEB_SEARCH_ENABLED,
  WEB_SEARCH_ENABLED_STORAGE_KEY,
  DEFAULT_OPENUI_ENABLED,
  OPENUI_ENABLED_STORAGE_KEY,
} from "@/lib/tool-preferences";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../SettingsRows";
import { AvailableMcpServersPanel } from "./AvailableMcpServersPanel";
import { ConnectorsPanel } from "./connectors/ConnectorsPanel";
import { McpServersPanel } from "./McpServersPanel";
import { ToolAccessChoice } from "./ToolAccessChoice";

export function ToolsForm({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const [webSearchEnabled, setWebSearchEnabled] = useLocalStorage<boolean>(
    WEB_SEARCH_ENABLED_STORAGE_KEY,
    DEFAULT_WEB_SEARCH_ENABLED,
  );
  const [openuiEnabled, setOpenuiEnabled] = useLocalStorage<boolean>(
    OPENUI_ENABLED_STORAGE_KEY,
    DEFAULT_OPENUI_ENABLED,
  );

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t("tools.page.title")}
        description={t("tools.page.description")}
      />

      <SettingsSection
        title={t("tools.builtIn.title")}
        description={t("tools.builtIn.description")}
      >
        <SettingsRow
          title={t("tools.builtIn.webSearch.title")}
          description={t("tools.builtIn.webSearch.description")}
          htmlFor="web-search-enabled"
          align="center"
          controlAlign="end"
          layout="toggle"
        >
          <Switch
            id="web-search-enabled"
            checked={webSearchEnabled}
            onCheckedChange={setWebSearchEnabled}
            aria-label={t("tools.builtIn.webSearch.toggleLabel")}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title={t("tools.interactiveUi.title")}
        description={t("tools.interactiveUi.description")}
      >
        <SettingsRow
          title={t("tools.interactiveUi.toolAccessTitle")}
          description={t("tools.interactiveUi.toolAccessDescription")}
          align="center"
          controlAlign="end"
        >
          <ToolAccessChoice
            label={t("tools.interactiveUi.toolAccessLabel")}
            alwaysOn={openuiEnabled}
            onChange={setOpenuiEnabled}
          />
        </SettingsRow>
      </SettingsSection>

      <ConnectorsPanel isAdmin={isAdmin} />

      <AvailableMcpServersPanel />

      {isAdmin && <McpServersPanel />}
    </SettingsPage>
  );
}
