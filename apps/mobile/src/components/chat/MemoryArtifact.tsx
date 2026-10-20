import { Ionicons } from "@expo/vector-icons";
import {
  describeMemoryToolPart,
  memoryToolArtifactLabel,
  memoryToolStatusLabel,
  type MemoryToolDisplay,
  type MemoryToolPart,
} from "@overtchat/shared";
import { useLayoutState } from "@shopify/flash-list";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "@/lib/theme";

export function MemoryArtifact({ parts }: { parts: MemoryToolPart[] }) {
  const { colors, fonts, radii } = useTheme();
  const [open, setOpen] = useLayoutState(false);
  const details = parts.map(describeMemoryToolPart);
  const running = details.some((detail) => detail.status === "running");
  const failed = details.some(
    (detail) =>
      detail.status === "error" ||
      detail.status === "missing" ||
      detail.status === "incomplete",
  );
  const label = memoryToolArtifactLabel(details);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.muted,
          borderColor: colors.border,
          borderRadius: radii.xl,
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((current) => !current)}
          style={({ pressed }) => [
            styles.toggle,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <View
            style={[
              styles.status,
              { backgroundColor: failed ? colors.background : colors.secondary },
            ]}
          >
            {running ? (
              <ActivityIndicator size={12} color={colors.primary} />
            ) : (
              <Ionicons
                name={failed ? "alert-circle-outline" : "checkmark"}
                size={14}
                color={failed ? colors.destructive : colors.primary}
              />
            )}
          </View>
          <Text
            numberOfLines={1}
            style={[
              styles.label,
              { color: colors.foreground, fontFamily: fonts.sansMedium },
            ]}
          >
            {label}
          </Text>
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={15}
            color={colors.mutedForeground}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage memories"
          onPress={() => router.push("/personalization")}
          hitSlop={6}
          style={({ pressed }) => [
            styles.manage,
            { opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Text
            style={[
              styles.manageText,
              {
                color: colors.mutedForeground,
                fontFamily: fonts.sansMedium,
              },
            ]}
          >
            Manage
          </Text>
        </Pressable>
      </View>

      {open ? (
        <View style={[styles.details, { borderTopColor: colors.border }]}>
          {details.map((detail, index) => (
            <MemoryDetail
              key={`${detail.action}:${detail.key ?? "memory"}:${index}`}
              detail={detail}
              divided={index > 0}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function MemoryDetail({
  detail,
  divided,
}: {
  detail: MemoryToolDisplay;
  divided: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={[
        styles.detail,
        divided ? { borderTopWidth: StyleSheet.hairlineWidth } : null,
        { borderTopColor: colors.border },
      ]}
    >
      <View style={styles.detailHeader}>
        <Text
          numberOfLines={1}
          style={[
            styles.key,
            { color: colors.mutedForeground, fontFamily: fonts.mono },
          ]}
        >
          {detail.key ?? "Memory"}
        </Text>
        <Text
          style={[
            styles.detailStatus,
            {
              color:
                detail.status === "error"
                  ? colors.destructive
                  : colors.mutedForeground,
              fontFamily: fonts.sansRegular,
            },
          ]}
        >
          {memoryToolStatusLabel(detail)}
        </Text>
      </View>
      {detail.value ? (
        <Text
          selectable
          style={[
            styles.value,
            { color: colors.foreground, fontFamily: fonts.sansRegular },
          ]}
        >
          {detail.value}
        </Text>
      ) : null}
      {detail.error ? (
        <Text
          style={[
            styles.error,
            { color: colors.destructive, fontFamily: fonts.sansRegular },
          ]}
        >
          {detail.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  header: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  toggle: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  status: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { minWidth: 0, flex: 1, fontSize: 13 },
  manage: { paddingHorizontal: 8, paddingVertical: 10 },
  manageText: { fontSize: 12 },
  details: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 },
  detail: { gap: 6, paddingVertical: 12 },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  key: { minWidth: 0, flex: 1, fontSize: 11 },
  detailStatus: { flexShrink: 0, fontSize: 11 },
  value: { fontSize: 14, lineHeight: 20 },
  error: { fontSize: 12, lineHeight: 18 },
});
