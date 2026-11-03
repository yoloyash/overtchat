import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import ImageViewing from "react-native-image-viewing";
import { getApiBase } from "@/lib/api";
import { useAuthCookie } from "@/lib/auth/useAuthCookie";
import { agentImageSource } from "@/lib/agents/model";
import { useTheme } from "@/lib/theme";

export function AgentImage({
  url,
  label,
  width = 160,
  height = 120,
}: {
  url: string;
  label: string;
  width?: number;
  height?: number;
}) {
  const { colors, radii } = useTheme();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const cookie = useAuthCookie();
  const source = agentImageSource(url, getApiBase(), cookie ?? "");
  if (source && "headers" in source && !cookie) return null;
  const frame = {
    width,
    height,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    overflow: "hidden" as const,
  };
  if (!source)
    return (
      <View
        accessible
        accessibilityLabel={`${label}, preview unavailable`}
        style={[frame, styles.center]}
      >
        <Ionicons name="image-outline" size={22} color={colors.mutedForeground} />
      </View>
    );
  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={
          failed ? `${label}, preview failed. Retry` : `View ${label}`
        }
        onPress={() => {
          if (failed) setFailed(false);
          else setOpen(true);
        }}
        style={({ pressed }) => [frame, { opacity: pressed ? 0.85 : 1 }]}
      >
        {failed ? (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Ionicons name="refresh" size={20} color={colors.mutedForeground} />
          </View>
        ) : (
          <Image
            source={source}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            onError={() => setFailed(true)}
          />
        )}
      </Pressable>
      <ImageViewing
        images={[source]}
        imageIndex={0}
        visible={open}
        onRequestClose={() => setOpen(false)}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
});
