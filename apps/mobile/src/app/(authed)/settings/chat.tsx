import { useChatPreferences, setChatPreferences } from "@/lib/chatPreferences";
import {
  SettingsPage,
  Section,
  Toggle,
  Row,
  QueryState,
  Label,
  WebRow,
  useRefreshOnFocus,
} from "@/components/settings/SettingsUI";
import { getAuthClient } from "@/lib/auth/client";
import {
  setWebSearchEnabled,
  useWebSearchEnabled,
} from "@/lib/toolPreferences";
import { useSettingsQuery, useSettingsMutation } from "@/lib/queries/settings";
import type { AvailableMcpServer } from "@overtchat/shared/admin-settings";
export default function ChatSettings() {
  const prefs = useChatPreferences();
  const web = useWebSearchEnabled();
  const session = getAuthClient().useSession();
  const query = useSettingsQuery<{ mcpServers: AvailableMcpServer[] }>(
    "/mcp-server-preferences",
  );
  const mutation = useSettingsMutation();
  useRefreshOnFocus(query.refetch);
  return (
    <SettingsPage title="Chat & tools">
      <Section
        title="Messages"
        description="Display preferences for this device."
      >
        <Toggle
          title="Message stats"
          detail="Token counts and generation speed below responses."
          value={prefs.messageStats}
          onChange={(messageStats) => setChatPreferences({ messageStats })}
        />
        <Toggle
          title="Context meter"
          detail="Context-window usage above your conversation."
          value={prefs.contextMeter}
          onChange={(contextMeter) => setChatPreferences({ contextMeter })}
        />
        <Toggle
          title="Session cost"
          detail="Recorded cost above your conversation, when pricing is available."
          value={prefs.sessionCost}
          onChange={(sessionCost) => setChatPreferences({ sessionCost })}
        />
      </Section>
      <Section title="Built-in tools" description="Saved on this device.">
        <Toggle
          title="Web search"
          detail="Allow supported models to search the web and fetch pages."
          value={web}
          onChange={setWebSearchEnabled}
        />
      </Section>
      <Section
        title="Connected tools"
        description="Your choices apply to your account on this server."
      >
        <QueryState query={query} />
        {query.data?.mcpServers.map((server) => (
          <Toggle
            key={server.id}
            title={server.name}
            value={server.enabled}
            disabled={mutation.isPending}
            onChange={(enabled) =>
              mutation.mutate({
                path: `/mcp-server-preferences/${server.id}`,
                body: { enabled },
              })
            }
          />
        ))}
        {query.data?.mcpServers.length === 0 && <RowEmpty />}
      </Section>
      {mutation.error && <Label error>{mutation.error.message}</Label>}
      {session.data?.user.role === "admin" && (
        <Section title="Administration">
          <WebRow
            title="Manage MCP servers"
            path="/settings/tools"
            detail="Add or configure tool servers in your browser."
          />
        </Section>
      )}
    </SettingsPage>
  );
}
function RowEmpty() {
  return (
    <Row
      title="No connected tools"
      detail="An administrator can add tool servers on web."
    />
  );
}
