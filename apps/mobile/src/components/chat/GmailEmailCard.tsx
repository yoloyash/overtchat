import { Ionicons } from "@expo/vector-icons";
import {
  GMAIL_EMAIL_STATUS_LABELS,
  describeGmailEmail,
  type GmailToolPart,
} from "@overtchat/shared";
import { useLayoutState } from "@shopify/flash-list";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { GmailLogo } from "@/components/GmailLogo";
import { useTheme } from "@/lib/theme";

/** A body longer than this starts folded. */
const FOLDED_LINES = 4;
const FOLDED_CHARS = 240;

/**
 * An email a model wrote: what it says and who it goes to. One that is in
 * Gmail opens there, where the user edits or sends it.
 */
export function GmailEmailCard({ part }: { part: GmailToolPart }) {
  const { colors, fonts } = useTheme();
  const [expanded, setExpanded] = useLayoutState(false);
  const email = describeGmailEmail(part);
  const sent = email.status === "sent";
  const href = email.href;
  const long =
    email.body.length > FOLDED_CHARS ||
    email.body.split("\n").length > FOLDED_LINES;
  const muted = { color: colors.mutedForeground, fontFamily: fonts.sansRegular };

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
