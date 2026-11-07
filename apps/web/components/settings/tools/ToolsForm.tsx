"use client";

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

export function ToolsForm({ isAdmin }: { isAdmin: boolean }) {
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
        title="Tools"
        description="Control model capabilities, connect your accounts, and add external tool servers."
      />

      <SettingsSection
        title="Built-in tools"
        description="Disabled tools are removed from chat requests."
      >
        <SettingsRow
          title="Web search"
          description="Allow supported models to search the web and fetch pages. Disabling this also turns off the Search action in chat."
          htmlFor="web-search-enabled"
          align="center"
          controlAlign="end"
          layout="toggle"
        >
          <Switch
            id="web-search-enabled"
            checked={webSearchEnabled}
            onCheckedChange={setWebSearchEnabled}
            aria-label="Enable web search"
          />
        </SettingsRow>
        <SettingsRow
          title="Interactive UI (OpenUI)"
          description="Load the OpenUI instructions into every chat, so supported models render interactive charts, tables, forms and cards without loading them first. That adds about 6,800 tokens to every request. When off, models load the instructions when a message calls for an interactive interface, or when you ask for one from the + menu or /openui."
          htmlFor="openui-enabled"
          align="center"
          controlAlign="end"
          layout="toggle"
        >
          <Switch
            id="openui-enabled"
            checked={openuiEnabled}
            onCheckedChange={setOpenuiEnabled}
            aria-label="Enable interactive UI"
          />
        </SettingsRow>
      </SettingsSection>

      <ConnectorsPanel isAdmin={isAdmin} />

      <AvailableMcpServersPanel />

      {isAdmin && <McpServersPanel />}
    </SettingsPage>
  );
}
