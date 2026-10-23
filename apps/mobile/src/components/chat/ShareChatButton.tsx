import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { collectOpenUIStates } from "@overtchat/shared";
import { useTheme } from "@/lib/theme";
import { getApiBase } from "@/lib/api";
import {
  useChatShare,
  useChangeChatShare,
  useSharePreview,
} from "@/lib/queries/shares";
import { useSpeech } from "@/lib/useSpeech";
import { MessageBubble } from "./MessageBubble";

const noop = () => {};

export function ShareChatButton({
  chatId,
  disabled,
}: {
  chatId: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share chat"
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={{ padding: 12, opacity: disabled ? 0.4 : 1 }}
      >
        <Ionicons name="share-outline" size={22} color={colors.foreground} />
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        {open && (
          <ShareChatContent chatId={chatId} onClose={() => setOpen(false)} />
        )}
      </Modal>
    </>
  );
}

function ShareChatContent({
  chatId,
  onClose,
}: {
  chatId: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const current = useChatShare(chatId);
  const preview = useSharePreview(chatId);
  const change = useChangeChatShare(chatId);
  const speech = useSpeech();
  const states = useMemo(
    () => collectOpenUIStates(preview.data?.messages ?? []),
    [preview.data],
  );
  const [showPreview, setShowPreview] = useState(false);
  const [nativeError, setNativeError] = useState("");
  const share = current.data?.share;
  const url = share
    ? (share.url ?? `${getApiBase()}/share/${encodeURIComponent(share.id)}`)
    : "";
  const error = change.error || current.error;
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={action}
      style={[
        styles.button,
        { backgroundColor: colors.secondary, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Text style={{ color: colors.secondaryForeground }}>{label}</Text>
    </Pressable>
  );

  async function shareLink() {
    try {
      await Share.share({ message: url, url });
      setNativeError("");
    } catch {
      setNativeError("Could not open sharing. Copy the link below.");
    }
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Share chat
        </Text>
        {button("Close", onClose)}
      </View>
      <Text style={{ color: colors.mutedForeground }}>
        Anyone with the link can read this conversation, including attachments,
        reasoning, and tool results. New messages and edits stay private until
        you update the link. Deleting this chat also removes its link.
      </Text>
      {share && (
        <>
          <Text selectable style={{ color: colors.foreground }}>
            {url}
          </Text>
          <View style={styles.actions}>
            {button("Share link", () => void shareLink())}
            {button("View shared chat", () => {
              void Linking.openURL(url).catch(() =>
                setNativeError("Could not open the shared chat."),
              );
            })}
          </View>
        </>
      )}
      {(error || nativeError) && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error?.message || nativeError}
        </Text>
      )}
      {preview.error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {preview.error.message}
        </Text>
      )}
      {current.isPending || preview.isPending ? <ActivityIndicator /> : null}
      {button(
        showPreview ? "Hide preview" : "Preview current conversation",
        () => setShowPreview(!showPreview),
        !preview.data,
      )}
      {showPreview && preview.data ? (
        <FlatList
          data={preview.data.messages}
          keyExtractor={(message) => message.id}
          contentContainerStyle={{ gap: 24, paddingVertical: 12 }}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              streaming={false}
              editing={false}
              readOnly
              speech={speech}
              onStartEdit={noop}
              onCancelEdit={noop}
              onSaveEdit={noop}
              onRegenerate={noop}
              openuiStates={states}
            />
          )}
        />
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <View style={styles.actions}>
        {share &&
          button("Unshare", () => change.mutate("DELETE"), change.isPending)}
        {button(
          change.isPending ? "Saving…" : share ? "Update link" : "Create link",
          () => change.mutate(share ? "PUT" : "POST"),
          change.isPending ||
            current.isPending ||
            !!current.error ||
            !preview.data ||
            !!preview.error,
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 22, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  button: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
});
