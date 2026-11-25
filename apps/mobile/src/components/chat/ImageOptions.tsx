import {
  IMAGE_SIZES,
  IMAGE_QUALITIES,
  type ImageGenerationOptions,
} from "@overtchat/shared";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

export function ImageOptions({
  value,
  model,
  supportsQuality = true,
  configuredSize,
  onChange,
  onClose,
}: {
  value: ImageGenerationOptions;
  model?: string | null;
  supportsQuality?: boolean;
  configuredSize?: string;
  onChange: (value: ImageGenerationOptions) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View
      style={{
        gap: 8,
        padding: 10,
        backgroundColor: colors.muted,
        borderRadius: 12,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          justifyContent: "space-between",
        }}
      >
        <Text style={{ color: colors.foreground, flex: 1 }}>
          {model ? t("chat.image.createTitleWithModel", { model }) : t("chat.image.createTitle")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("chat.image.removeRequest")}
          onPress={onClose}
          hitSlop={12}
        >
          <Text style={{ color: colors.primary }}>{t("chat.share.close")}</Text>
        </Pressable>
      </View>
      {configuredSize ? (
        <Text style={{ color: colors.mutedForeground }}>
          {t("chat.image.sizeConfigured", {
            size:
              configuredSize === "auto"
                ? t("chat.image.backendDefault")
                : configuredSize,
          })}
        </Text>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {IMAGE_SIZES.map((size) => (
            <Pressable
              key={size}
              accessibilityRole="button"
              accessibilityLabel={t("chat.mobile.image.sizeOption", { size: t(`chat.image.sizes.${size}`) })}
              accessibilityState={{ selected: value.size === size }}
              onPress={() => onChange({ ...value, size })}
              style={{
                padding: 8,
                borderRadius: 8,
                backgroundColor:
                  value.size === size ? colors.accent : colors.background,
              }}
            >
              <Text style={{ color: colors.foreground }}>
                {t(`chat.image.sizes.${size}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {supportsQuality && (
        <>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            {t("chat.image.qualityLabel")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {IMAGE_QUALITIES.map((quality) => (
              <Pressable
                key={quality}
                accessibilityRole="button"
                accessibilityLabel={t("chat.mobile.image.qualityOption", { quality: t(`chat.image.qualities.${quality}`) })}
                accessibilityState={{ selected: value.quality === quality }}
                onPress={() => onChange({ ...value, quality })}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  backgroundColor:
                    value.quality === quality
                      ? colors.accent
                      : colors.background,
                }}
              >
                <Text style={{ color: colors.foreground }}>{t(`chat.image.qualities.${quality}`)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
