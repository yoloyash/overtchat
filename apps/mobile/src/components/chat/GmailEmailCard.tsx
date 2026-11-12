import { Ionicons } from "@expo/vector-icons";
import {
  GMAIL_EMAIL_STATUS_LABELS,
  describeGmailEmail,
  getErrorMessage,
  gmailEmailResult,
  subscribeGmailEmailResults,
  type GmailToolPart,
} from "@overtchat/shared";
import { useLayoutState } from "@shopify/flash-list";
import { useSyncExternalStore } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { GmailLogo } from "@/components/GmailLogo";
import { useSaveGmailEmail, useSendGmailEmail } from "@/lib/queries/gmail-emails";
import { useTheme } from "@/lib/theme";

/** A body longer than this starts folded. */
const FOLDED_LINES = 4;
const FOLDED_CHARS = 240;

/**
 * An email a model wrote: what it says, who it goes to, and the only way it
 * gets sent unless the user let models send, which is pressing Send. Until
 * then it is only in the chat, unless the user saves it in Gmail to edit it
 * there. One that is in Gmail opens there.
 */
export function GmailEmailCard({
  part,
  replaced,
  canSend,
}: {
  part: GmailToolPart;
  /** Emails a later version in the conversation took the place of. */
  replaced?: ReadonlySet<string>;
  /** False where the reader cannot act on the chat, or it is still being written. */
  canSend: boolean;
}) {
  const { colors, fonts, radii } = useTheme();
  const [expanded, setExpanded] = useLayoutState(false);
  const send = useSendGmailEmail();
  const save = useSaveGmailEmail();
  const loaded = describeGmailEmail(part, replaced);
  // What this app did since, which outlives the list recycling the card.
  const done = useSyncExternalStore(
    subscribeGmailEmailResults,
    () => gmailEmailResult(loaded.id),
    () => undefined,
  );
  const email = done
    ? describeGmailEmail(
        { ...part, output: { ...(part.output as object), ...done } },
        replaced,
      )
    : loaded;
  const sent = email.status === "sent";
  const href = email.href;
  const long =
    email.body.length > FOLDED_CHARS ||
    email.body.split("\n").length > FOLDED_LINES;
  const muted = { color: colors.mutedForeground, fontFamily: fonts.sansRegular };
  const busy = send.isPending || save.isPending;
  const actions = canSend && !sent && email.status !== "replaced";
  const failure = send.isError
    ? getErrorMessage(send.error, "Could not send the email.")
    : save.isError
      ? getErrorMessage(save.error, "Could not save the email in Gmail.")
      : null;

  return (
    <View
      style={[
        styles.card,
        { borderColor: colors.border, backgroundColor: colors.muted },
      ]}
    >
      <Pressable
        disabled={!href}
        accessibilityRole={href ? "link" : undefined}
        accessibilityLabel={
          href ? (sent ? "Open in Gmail" : "Open drafts in Gmail") : undefined
        }
        onPress={() => {
          if (href) Linking.openURL(href).catch(() => {});
        }}
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.7 : 1 }]}
      >
        <GmailLogo size={16} />
        <View style={styles.heading}>
          <Text
            numberOfLines={1}
            style={[
              styles.subject,
              { color: colors.foreground, fontFamily: fonts.sansMedium },
            ]}
          >
            {email.subject}
          </Text>
          <Text numberOfLines={1} style={[styles.meta, muted]}>
            {[GMAIL_EMAIL_STATUS_LABELS[email.status], email.recipients]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        {href ? (
          <Ionicons name="open-outline" size={14} color={colors.mutedForeground} />
        ) : null}
      </Pressable>
      {email.body ? (
        <View style={[styles.body, { borderTopColor: colors.border }]}>
          <Text
            numberOfLines={long && !expanded ? FOLDED_LINES : undefined}
            style={[
              styles.bodyText,
              { color: colors.foreground, fontFamily: fonts.sansRegular },
            ]}
          >
            {email.body}
          </Text>
          {long ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpanded(!expanded)}
              hitSlop={8}
            >
              <Text style={[styles.meta, muted]}>
                {expanded ? "Show less" : "Show all"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {failure && !sent ? (
        <Text
          style={[
            styles.failure,
            {
              borderTopColor: colors.border,
              color: colors.destructive,
              fontFamily: fonts.sansRegular,
            },
          ]}
        >
          {failure}
        </Text>
      ) : null}
      {actions ? (
        <View style={[styles.actions, { borderTopColor: colors.border }]}>
          {email.status === "unsent" ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              hitSlop={6}
              onPress={() => {
                send.reset();
                save.mutate(email);
              }}
              style={[styles.action, { opacity: busy ? 0.5 : 1 }]}
            >
              <Text
                style={[
                  styles.actionText,
                  { color: colors.foreground, fontFamily: fonts.sansMedium },
                ]}
              >
                {save.isPending ? "Saving…" : "Save to Gmail"}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            hitSlop={6}
            onPress={() => {
              save.reset();
              send.mutate(email);
            }}
            style={[
              styles.action,
              {
                backgroundColor: colors.primary,
                borderRadius: radii.pill,
                opacity: busy ? 0.5 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.actionText,
                { color: colors.primaryForeground, fontFamily: fonts.sansMedium },
              ]}
            >
              {send.isPending ? "Sending…" : "Send"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  heading: { flex: 1, minWidth: 0 },
  subject: { fontSize: 13 },
  meta: { fontSize: 12 },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  bodyText: { fontSize: 13, lineHeight: 19 },
  failure: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },
  actions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  action: { paddingHorizontal: 12, paddingVertical: 6 },
  actionText: { fontSize: 13 },
});
