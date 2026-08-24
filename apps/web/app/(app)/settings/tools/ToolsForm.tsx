"use client";

import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_WEB_SEARCH_ENABLED,
  WEB_SEARCH_ENABLED_STORAGE_KEY,
} from "@/lib/tool-preferences";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../_components/SettingsRows";
import { AvailableMcpServersPanel } from "./AvailableMcpServersPanel";
import { McpServersPanel } from "./McpServersPanel";

export function ToolsForm({ isAdmin }: { isAdmin: boolean }) {
  const [webSearchEnabled, setWebSearchEnabled] = useLocalStorage<boolean>(
    WEB_SEARCH_ENABLED_STORAGE_KEY,
    DEFAULT_WEB_SEARCH_ENABLED,
  );

  return (
    <div className="max-w-3xl space-y-8">
      <SettingsPageHeader
        title="Tools"
        description="Control model capabilities and connect external tool servers."
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
        >
          <Switch
            id="web-search-enabled"
            checked={webSearchEnabled}
            onCheckedChange={setWebSearchEnabled}
            aria-label="Enable web search"
          />
        </SettingsRow>
      </SettingsSection>

      <AvailableMcpServersPanel />

      {isAdmin && <McpServersPanel />}
    </div>
  );
}
