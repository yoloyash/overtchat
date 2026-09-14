import {
  IMAGE_SIZE_LABELS,
  isGeneratedImage,
  type GeneratedImage,
  type ImageToolPart,
} from "@overtchat/shared";
import type { FileUIPart } from "ai";
import { Directory, File, Paths } from "expo-file-system";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { getApiBase, getAuthCookie } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";
import { AttachmentChip } from "./AttachmentChip";

export function GeneratedImageCard({
  part,
  streaming,
  onReference,
}: {
  part: ImageToolPart;
  streaming: boolean;
  onReference?: (file: FileUIPart) => void;
}) {
  const { colors } = useTheme();
  const [saving, setSaving] = useState(false);
  const pending =
    part.state === "input-streaming" || part.state === "input-available";
  const images = Array.isArray(part.output?.images)
    ? part.output.images.filter(isGeneratedImage)
    : [];
  async function save(image: GeneratedImage) {
    setSaving(true);
    let downloaded: File | undefined;
    try {
      const directory = await Directory.pickDirectoryAsync();
      const cookie = getAuthCookie();
      downloaded = await File.downloadFileAsync(
        `${getApiBase()}${image.url}`,
        new File(Paths.cache, `${image.id}-${image.filename}`),
        {
          headers: cookie ? { Cookie: cookie } : undefined,
          idempotent: true,
        },
      );
      await downloaded.copy(
        new File(directory, `${image.id}-${image.filename}`),
      );
      toastSuccess("Image saved");
    } catch (error) {
      if (!(error instanceof Error && /cancel/i.test(error.message)))
        toastError("Could not save image", error);
    } finally {
      try {
        downloaded?.delete();
      } catch {
        /* Cache cleanup is best effort. */
      }
      setSaving(false);
    }
  }
  return (
    <View style={{ gap: 10, marginVertical: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {pending && streaming && (
          <ActivityIndicator color={colors.mutedForeground} />
        )}
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.mutedForeground }}
        >
          {pending
            ? streaming
              ? part.type === "tool-edit_image"
                ? "Editing image…"
                : "Creating image…"
              : "Image generation stopped"
            : part.state === "output-error"
              ? "Image generation failed"
              : "Image created"}
        </Text>
      </View>
      {part.state === "output-error" && (
        <Text style={{ color: colors.destructive }}>{part.errorText}</Text>
      )}
      {images.map((image) => {
        const file: FileUIPart = {
          type: "file",
          url: image.url,
          mediaType: image.mediaType,
          filename: image.filename,
        };
        return (
          <View key={image.id} style={{ gap: 8 }}>
            <AttachmentChip attachment={file} large />
            <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
              <Pressable
                disabled={saving}
                accessibilityRole="button"
                onPress={() => void save(image)}
                style={{ paddingVertical: 8 }}
              >
                <Text style={{ color: colors.primary }}>
                  {saving ? "Saving…" : "Download"}
                </Text>
              </Pressable>
              {onReference && (
                <Pressable
                  disabled={streaming}
                  accessibilityRole="button"
                  onPress={() => onReference(file)}
                  style={{ paddingVertical: 8 }}
                >
                  <Text style={{ color: colors.primary }}>
                    Edit / Use as reference
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
      {part.output && (
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
          {part.output.model} · Requested format:{" "}
          {IMAGE_SIZE_LABELS[part.output.size] ?? "Auto"} · Quality:{" "}
          {part.output.quality}
        </Text>
      )}
    </View>
  );
}
