import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AgentQueuedMessage } from "@overtchat/agent-bridge";
import { useTheme } from "@/lib/theme";

export function AgentQueuedMessages({
  messages,
  running,
  supportsSteer,
  disabled,
  editDisabled,
  onEdit,
  onSteer,
  onRemove,
}: {
  messages: AgentQueuedMessage[];
  running: boolean;
  supportsSteer: boolean;
  disabled: boolean;
  editDisabled: boolean;
  onEdit: (message: AgentQueuedMessage) => void;
  onSteer: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { colors, fonts } = useTheme();
  if (!messages.length) return null;
  return (
    <ScrollView
      accessibilityLabel="Pending messages"
      style={{ maxHeight: 160 }}
      contentContainerStyle={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        gap: 8,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {messages.map((message) => {
        const sending = message.status === "sending";
        const uncertain = message.status === "uncertain";
        const imageCount = message.images?.length ?? 0;
        return (
          <View
            key={message.id}
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              paddingLeft: 12,
              paddingRight: 4,
              paddingVertical: 6,
              backgroundColor: colors.card,
            }}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Ionicons
                name="list-outline"
                size={16}
                color={colors.mutedForeground}
              />
            )}
            <View
              style={{
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: 140,
                minWidth: 0,
                gap: 3,
              }}
            >
              <Text
                numberOfLines={2}
                style={{
                  color: colors.foreground,
                  fontFamily: fonts.sansRegular,
                  fontSize: 13,
                }}
              >
                {message.message ||
                  `${imageCount} attached ${imageCount === 1 ? "image" : "images"}`}
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: fonts.sansRegular,
                  fontSize: 11,
                }}
              >
                {uncertain
                  ? "Delivery unknown — check the chat before resending"
                  : sending
                    ? "Sending"
                    : "Queued"}
                {imageCount
                  ? ` · ${imageCount} ${imageCount === 1 ? "image" : "images"}`
                  : ""}
              </Text>
            </View>
            {!sending && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  flexGrow: 1,
                }}
              >
                <Action
                  label="Edit queued message"
                  icon="pencil-outline"
                  disabled={disabled || editDisabled}
                  onPress={() => onEdit(message)}
                />
                {supportsSteer && running && !uncertain && (
                  <Action
                    label="Steer with queued message"
                    icon="return-up-forward-outline"
                    text="Steer"
                    disabled={disabled}
                    onPress={() => onSteer(message.id)}
                  />
                )}
                <Action
                  label="Delete queued message"
                  icon="trash-outline"
                  disabled={disabled}
                  onPress={() => onRemove(message.id)}
                />
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function Action({
  label,
  icon,
  text,
  disabled,
  onPress,
}: {
  label: string;
  text?: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 44,
        height: 44,
        paddingHorizontal: text ? 8 : 0,
        flexDirection: "row",
        gap: 4,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        backgroundColor: pressed ? colors.muted : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Ionicons name={icon} size={18} color={colors.mutedForeground} />
      {!!text && (
        <Text style={{ color: colors.foreground, fontSize: 12 }}>{text}</Text>
      )}
    </Pressable>
  );
}
