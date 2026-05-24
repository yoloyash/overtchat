import { Ionicons } from "@expo/vector-icons";
import type { FileUIPart } from "ai";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getApiBase, getAuthCookie } from "@/lib/api";
import {
  type AttachmentCategory,
  type AttachmentMeta,
  formatSize,
} from "@/lib/chat/attachments";
import { useTheme } from "@/lib/theme";

const IMAGE_SIZE = 64;

function categoryIcon(
  category: AttachmentCategory | undefined,
): keyof typeof Ionicons.glyphMap {
  switch (category) {
    case "text":
      return "code-slash-outline";
    case "spreadsheet":
      return "grid-outline";
    case "document":
      return "document-text-outline";
    default:
      return "document-outline";
  }
}

function isImageAttachment(
  attachment: FileUIPart,
  meta: AttachmentMeta | undefined,
) {
  return (
    meta?.category === "image" ||
    (!meta && attachment.mediaType?.startsWith("image/"))
  );
}

function resolveUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${getApiBase()}${url}`;
}

export function AttachmentChip({
  attachment,
  meta,
  onRemove,
}: {
  attachment: FileUIPart;
  meta?: AttachmentMeta;
  onRemove?: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const label = attachment.filename ?? "file";
  const cookie = getAuthCookie();

  if (isImageAttachment(attachment, meta)) {
    const localUri = meta?.localUri;
    const source = localUri
      ? { uri: localUri }
      : {
          uri: resolveUrl(attachment.url),
          headers: cookie ? { Cookie: cookie } : undefined,
        };
    return (
      <View
        style={[
          styles.imageWrap,
          {
            borderColor: colors.border,
            backgroundColor: colors.muted,
            borderRadius: radii.md,
          },
        ]}
      >
        <Image
          source={source}
          style={styles.image}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessibilityLabel={label}
        />
        {onRemove && (
          <RemoveButton onPress={onRemove} label={label} />
        )}
      </View>
    );
  }

  const sub = [
    meta?.pageCount ? `${meta.pageCount} pages` : null,
    meta?.size != null ? formatSize(meta.size) : null,
    meta?.truncated ? "truncated" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View
      style={[
        styles.docWrap,
        {
          borderColor: colors.border,
          backgroundColor: colors.muted,
          borderRadius: radii.md,
          paddingRight: onRemove ? 30 : 12,
        },
      ]}
    >
      <View
        style={[
          styles.docIcon,
          { backgroundColor: colors.background, borderRadius: radii.sm },
        ]}
      >
        <Ionicons
          name={categoryIcon(meta?.category)}
          size={16}
          color={colors.mutedForeground}
        />
      </View>
      <View style={styles.docMeta}>
        <Text
          numberOfLines={1}
          style={[
            styles.docLabel,
            { color: colors.foreground, fontFamily: fonts.sansMedium },
          ]}
        >
          {label}
        </Text>
        {sub ? (
          <Text
            numberOfLines={1}
            style={[
              styles.docSub,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      {onRemove && <RemoveButton onPress={onRemove} label={label} />}
    </View>
  );
}

function RemoveButton({
  onPress,
  label,
}: {
  onPress: () => void;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${label}`}
      style={({ pressed }) => [
        styles.removeBtn,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name="close" size={12} color={colors.foreground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  imageWrap: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  image: { width: "100%", height: "100%" },
  docWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 8,
    maxWidth: 240,
    borderWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  docIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  docMeta: { flex: 1, minWidth: 0 },
  docLabel: { fontSize: 12 },
  docSub: { fontSize: 11, marginTop: 1 },
  removeBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
