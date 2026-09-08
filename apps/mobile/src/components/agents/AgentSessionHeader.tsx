import { Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  agentProviderMetadata,
  type AgentProviderId,
} from "@overtchat/agent-bridge";
import { useTheme } from "@/lib/theme";
import { AgentProviderIcon } from "./AgentProviderIcon";
import { AgentWorkingIndicator } from "./AgentWorkingIndicator";
import { AgentBranch } from "./AgentNavigation";

// Use the native navigation bar's title slot so back gestures, safe areas and
// keyboard offsets remain owned by Expo Router.
export function AgentSessionHeaderTitle({
  title,
  provider,
  workspace,
  workspaceName,
  working = false,
}: {
  title: string;
  provider?: AgentProviderId;
  workspace?: string;
  workspaceName: string;
  working?: boolean;
}) {
  const { colors, fonts } = useTheme();
  const { width } = useWindowDimensions();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        maxWidth: Math.max(120, width - 148),
      }}
    >
      <View
        accessible
        accessibilityLabel={
          provider ? `${agentProviderMetadata(provider).label} agent` : "Agent"
        }
      >
        {provider ? (
          <AgentProviderIcon provider={provider} size={28} />
        ) : (
          <Ionicons
            name="terminal-outline"
            size={24}
            color={colors.mutedForeground}
          />
        )}
      </View>
      <View style={{ flexShrink: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            numberOfLines={1}
            accessibilityRole="header"
            style={{
              color: colors.foreground,
              fontFamily: fonts.sansSemiBold,
              fontSize: 16,
              lineHeight: 21,
              flexShrink: 1,
            }}
          >
            {title}
          </Text>
          {working && <AgentWorkingIndicator />}
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          {workspace ? (
            <AgentBranch workspace={workspace} fallback={workspaceName} />
          ) : workspaceName !== title ? (
            <Text
              numberOfLines={1}
              style={{
                color: colors.mutedForeground,
                fontFamily: fonts.sansRegular,
                fontSize: 12,
                lineHeight: 16,
              }}
            >
              {workspaceName}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
