import { useLayoutState } from "@shopify/flash-list";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

const COLLAPSED_LINES = 4;
// About four lines of a phone-width bubble.
const COLLAPSED_LENGTH = 160;

/** A passage a user message replies to; long ones open on request. */
export function UserQuote({ text }: { text: string }) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useLayoutState(false);
  const long =
    text.length > COLLAPSED_LENGTH ||
    text.split("\n").length > COLLAPSED_LINES;

  return (
    <View style={[styles.quote, { borderLeftColor: colors.border }]}>
      <Text
        style={[
          styles.text,
          { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
        ]}
        numberOfLines={long && !expanded ? COLLAPSED_LINES : undefined}
        selectable
      >
        {text}
      </Text>
      {long ? (
        <Pressable
          onPress={() => setExpanded((current) => !current)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
        >
          <Text
            style={[
              styles.toggle,
              { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
            ]}
          >
            {expanded ? t("common.actions.showLess") : t("common.actions.showMore")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  quote: { borderLeftWidth: 2, paddingLeft: 10, gap: 4 },
  text: { fontSize: 15, lineHeight: 22 },
  toggle: { fontSize: 13, lineHeight: 18 },
});
