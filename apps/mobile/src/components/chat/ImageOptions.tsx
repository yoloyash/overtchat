import {
  IMAGE_SIZES,
  IMAGE_SIZE_LABELS,
  IMAGE_QUALITIES,
  type ImageGenerationOptions,
} from "@overtchat/shared";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

export function ImageOptions({
  value,
  model,
  supportsQuality = true,
  onChange,
  onClose,
}: {
  value: ImageGenerationOptions;
  model?: string | null;
  supportsQuality?: boolean;
  onChange: (value: ImageGenerationOptions) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
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
          Create image{model ? ` · ${model}` : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove image request"
          onPress={onClose}
          hitSlop={12}
        >
          <Text style={{ color: colors.primary }}>Close</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {IMAGE_SIZES.map((size) => (
          <Pressable
            key={size}
            accessibilityRole="button"
            accessibilityLabel={`Image size: ${IMAGE_SIZE_LABELS[size]}`}
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
              {IMAGE_SIZE_LABELS[size]}
            </Text>
          </Pressable>
        ))}
      </View>
      {supportsQuality && (
        <>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            Quality
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {IMAGE_QUALITIES.map((quality) => (
              <Pressable
                key={quality}
                accessibilityRole="button"
                accessibilityLabel={`Image quality: ${quality}`}
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
                <Text style={{ color: colors.foreground }}>{quality}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
