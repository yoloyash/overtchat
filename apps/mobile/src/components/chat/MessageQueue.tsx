import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ChatMessageQueue, QueuedChatMessage } from "@overtchat/shared";
import { useTheme } from "@/lib/theme";

export interface MessageQueueProps
  extends ReturnType<ChatMessageQueue["getSnapshot"]> {
  queue: ChatMessageQueue;
}

export function MessageQueue({
  queue,
  messages,
  paused,
  sendingId,
  editingId,
  error,
}: MessageQueueProps) {
  const { colors, fonts } = useTheme();
  if (!messages.length && !error) return null;
  return (
    <View
      accessibilityLabel="Queued messages"
      style={[styles.container, { borderColor: colors.border }]}
    >
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: fonts.sansRegular,
          fontSize: 12,
        }}
      >
        {paused ? "Queue paused — use Send now to continue" : "Queued messages"}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
      <ScrollView
        style={{ maxHeight: 200 }}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((message) =>
          editingId === message.id ? (
            <QueueEditor key={message.id} message={message} queue={queue} />
          ) : (
            <View key={message.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={2}
                  style={{
                    color: colors.foreground,
                    fontFamily: fonts.sansRegular,
                  }}
                >
                  {message.text}
                </Text>
                {message.files.map((file, index) => (
                  <Text
                    key={index}
                    numberOfLines={1}
                    style={{ color: colors.mutedForeground, fontSize: 12 }}
                  >
                    {file.filename || "Attachment"}
                  </Text>
                ))}
              </View>
              <QueueButton
                label={
                  sendingId === message.id
                    ? "Sending queued message"
                    : "Send now"
                }
                icon="arrow-up"
                disabled={sendingId !== null}
                onPress={() => void queue.sendNow(message.id)}
              />
              <QueueButton
                label="Edit queued message"
                icon="pencil"
                disabled={sendingId === message.id}
                onPress={() => queue.edit(message.id)}
              />
              <QueueButton
                label="Delete queued message"
                icon="trash-outline"
                disabled={sendingId === message.id}
                onPress={() => queue.remove(message.id)}
              />
            </View>
          ),
        )}
      </ScrollView>
    </View>
  );
}

function QueueButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: "arrow-up" | "pencil" | "trash-outline";
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { opacity: disabled ? 0.4 : 1 }]}
    >
      <Ionicons name={icon} size={18} color={colors.foreground} />
    </Pressable>
  );
}

function QueueEditor({
  message,
  queue,
}: {
  message: QueuedChatMessage;
  queue: ChatMessageQueue;
}) {
  const { colors } = useTheme();
  const [text, setText] = useState(message.text);
  return (
    <View style={{ gap: 8, paddingVertical: 8 }}>
      <TextInput
        accessibilityLabel="Edit queued message text"
        multiline
        autoFocus
        value={text}
        onChangeText={setText}
        style={{
          color: colors.foreground,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 8,
          maxHeight: 120,
        }}
      />
      {message.files.map((file, index) => (
        <Text
          key={index}
          numberOfLines={1}
          style={{ color: colors.mutedForeground, fontSize: 12 }}
        >
          {file.filename || "Attachment"}
        </Text>
      ))}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={!text.trim() && !message.files.length}
          onPress={() => queue.save(message.id, text)}
          style={styles.textButton}
        >
          <Text style={{ color: colors.foreground }}>Save queued message</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => queue.edit(null)}
          style={styles.textButton}
        >
          <Text style={{ color: colors.mutedForeground }}>Cancel edit</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 8,
    gap: 4,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  button: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  textButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
});
