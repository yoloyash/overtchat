import { Image } from "expo-image";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

export function UserAvatar({
  name,
  email,
  image,
  size = 36,
}: {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  size?: number;
}) {
  const { colors, fonts } = useTheme();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const source = name?.trim() || email?.trim() || "?";
  const parts = source.split(/\s+/);
  const initials = (
    parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2)
  ).toUpperCase();
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.primary,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Text
        style={{
          color: colors.primaryForeground,
          fontFamily: fonts.sansSemiBold,
          fontSize: size * 0.36,
        }}
      >
        {initials}
      </Text>
      {image && /^https?:\/\//i.test(image) && image !== failedImage && (
        <Image
          source={{ uri: image }}
          recyclingKey={image}
          onError={() => setFailedImage(image)}
          contentFit="cover"
          style={{ position: "absolute", width: size, height: size }}
        />
      )}
    </View>
  );
}
