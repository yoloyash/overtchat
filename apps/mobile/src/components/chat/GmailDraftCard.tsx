import { Ionicons } from "@expo/vector-icons";
import { describeGmailDraft, type GmailToolPart } from "@overtchat/shared";
import { useLayoutState } from "@shopify/flash-list";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { GmailLogo } from "@/components/GmailLogo";
import { useTheme } from "@/lib/theme";

/** A body longer than this starts folded. */
const FOLDED_LINES = 4;
const FOLDED_CHARS = 240;

/**
 * A draft a model saved in the user's Gmail: what it says and who it goes
 * to. It opens in Gmail, where the user edits or sends it.
 */
export function GmailDraftCard({ part }: { part: GmailToolPart }) {
  const { colors, fonts } = useTheme();
  const [expanded, setExpanded] = useLayoutState(false);
  const draft = describeGmailDraft(part);
  const sent = draft.sentAt !== undefined;
  const long =
    draft.body.length > FOLDED_CHARS ||
    draft.body.split("\n").length > FOLDED_LINES;
  const muted = { color: colors.mutedForeground, fontFamily: fonts.sansRegular };

  return (
    <View
      style={[
        styles.card,
        { borderColor: colors.border, backgroundColor: colors.muted },
      ]}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={sent ? "Open in Gmail" : "Open drafts in Gmail"}
        onPress={() => Linking.openURL(draft.href).catch(() => {})}
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
            {draft.subject}
          </Text>
          <Text numberOfLines={1} style={[styles.meta, muted]}>
            {[sent ? "Sent" : "Draft, not sent", draft.recipients]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        <Ionicons name="open-outline" size={14} color={colors.mutedForeground} />
      </Pressable>
      {draft.body ? (
        <View style={[styles.body, { borderTopColor: colors.border }]}>
          <Text
            numberOfLines={long && !expanded ? FOLDED_LINES : undefined}
            style={[
              styles.bodyText,
              { color: colors.foreground, fontFamily: fonts.sansRegular },
            ]}
          >
            {draft.body}
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
});
