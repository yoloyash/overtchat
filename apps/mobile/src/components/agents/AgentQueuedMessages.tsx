import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
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
  const { t } = useTranslation();
  const { colors, fonts, radii } = useTheme();
  if (!messages.length) return null;
  return (
    <ScrollView
      accessibilityLabel={t("agents.composer.pendingMessages")}
      style={{ maxHeight: 160 }}
      contentContainerStyle={{ gap: 8 }}
      keyboardShouldPersistTaps="handled"
    >
      {messages.map((message) => {
        const sending = message.status === "sending";
        const uncertain = message.status === "uncertain";
        const imageCount = message.images?.length ?? 0;
        const statusLabel = uncertain
          ? t("agents.mobile.composer.deliveryUnknown")
          : sending
            ? t("agents.composer.sending")
            : t("agents.composer.queued");
        return (
          <View
            key={message.id}
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
              borderRadius: radii.xl,
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
                  t("agents.composer.attachedImages", { count: imageCount })}
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: fonts.sansRegular,
                  fontSize: 11,
                }}
              >
                {imageCount
                  ? t("agents.composer.queuedStatusWithImages", {
                      status: statusLabel,
                      count: imageCount,
                    })
                  : statusLabel}
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
                  label={t("agents.composer.editQueued")}
                  icon="pencil-outline"
                  disabled={disabled || editDisabled}
                  onPress={() => onEdit(message)}
                />
                {supportsSteer && running && !uncertain && (
                  <Action
                    label={t("agents.composer.steerWithQueued")}
                    icon="return-up-forward-outline"
                    text={t("agents.composer.steer")}
                    disabled={disabled}
                    onPress={() => onSteer(message.id)}
                  />
                )}
                <Action
                  label={t("agents.composer.deleteQueued")}
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
