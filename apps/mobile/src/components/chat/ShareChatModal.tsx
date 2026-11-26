import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

/** Share sheet for one chat, opened from the header menu. */
export function ShareChatModal({
  chatId,
  open,
  onClose,
}: {
  chatId: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {open && <ShareChatContent chatId={chatId} onClose={onClose} />}
    </Modal>
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
  const { t } = useTranslation();
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
      setNativeError(t("chat.mobile.share.openShareFailed"));
    }
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t("chat.share.title")}
        </Text>
        {button(t("common.actions.close"), onClose)}
      </View>
      <Text style={{ color: colors.mutedForeground }}>
        {t("chat.mobile.share.description")}
      </Text>
      {share && (
        <>
          <Text selectable style={{ color: colors.foreground }}>
            {url}
          </Text>
          <View style={styles.actions}>
            {button(t("chat.mobile.share.shareLink"), () => void shareLink())}
            {button(t("chat.share.viewShared"), () => {
              void Linking.openURL(url).catch(() =>
                setNativeError(t("chat.mobile.share.openSharedFailed")),
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
        showPreview ? t("chat.mobile.share.hidePreview") : t("chat.share.previewSummary"),
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
          button(t("chat.share.unshare"), () => change.mutate("DELETE"), change.isPending)}
        {button(
          change.isPending ? t("common.states.saving") : share ? t("chat.share.updateLink") : t("chat.share.createLink"),
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
