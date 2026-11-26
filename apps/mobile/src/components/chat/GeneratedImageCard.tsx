import {
  isGeneratedImage,
  type GeneratedImage,
  type ImageToolPart,
} from "@overtchat/shared";
import type { FileUIPart } from "ai";
import { Directory, File, Paths } from "expo-file-system";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      const baseURL = getApiBase();
      const cookie = await getAuthCookie();
      downloaded = await File.downloadFileAsync(
        `${baseURL}${image.url}`,
        new File(Paths.cache, `${image.id}-${image.filename}`),
        {
          headers: cookie ? { Cookie: cookie } : undefined,
          idempotent: true,
        },
      );
      await downloaded.copy(
        new File(directory, `${image.id}-${image.filename}`),
      );
      toastSuccess(t("chat.mobile.image.saved"));
    } catch (error) {
      if (!(error instanceof Error && /cancel/i.test(error.message)))
        toastError(t("chat.mobile.image.saveFailed"), error);
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
                ? t("chat.image.editing")
                : t("chat.image.creating")
              : t("chat.image.stopped")
            : part.state === "output-error"
              ? t("chat.image.failed")
              : t("chat.image.created")}
        </Text>
      </View>
      {part.state === "output-error" && (
        <Text style={{ color: colors.destructive }}>{part.errorText}</Text>
      )}
      {images.map((image) => {
        const file: FileUIPart = {
          // eslint-disable-next-line i18next/no-literal-string -- FileUIPart type discriminator
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
                  {saving ? t("common.states.saving") : t("common.actions.download")}
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
                    {t("chat.image.editOrReference")}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
      {part.output && (
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
          {(() => {
            const format =
              part.output.providerSize === "auto"
                ? t("chat.image.backendDefault")
                : (part.output.providerSize ??
                  (part.output.size in
                  { auto: 1, "1024x1024": 1, "1536x1024": 1, "1024x1536": 1 }
                    ? t(`chat.image.sizes.${part.output.size}`)
                    : t("chat.image.auto")));
            const details =
              part.output.providerSize === undefined
                ? t("chat.image.requestedFormatWithQuality", {
                    format,
                    quality: t(`chat.image.qualities.${part.output.quality}`),
                  })
                : t("chat.image.requestedFormat", { format });
            return `${part.output.model} · ${details}`;
          })()}
        </Text>
      )}
    </View>
  );
}
