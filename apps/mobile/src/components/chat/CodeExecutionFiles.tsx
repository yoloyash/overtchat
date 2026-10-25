import { isPreviewableImage, type CodeExecutionFile } from "@overtchat/shared";
import { Directory } from "expo-file-system";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { authFetch, getApiBase } from "@/lib/api";
import type { AttachmentCategory } from "@/lib/chat/attachments";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";
import { AttachmentChip } from "./AttachmentChip";

function categoryOf(file: CodeExecutionFile): AttachmentCategory {
  if (isPreviewableImage(file)) return "image";
  if (file.mediaType === "text/csv" || file.mediaType.includes("spreadsheetml")) {
    return "spreadsheet";
  }
  if (file.mediaType.startsWith("text/") || file.mediaType === "application/json") {
    return "text";
  }
  return "document";
}

/** Files code runs returned: images preview inline, and any file saves to a chosen folder. */
export function CodeExecutionFiles({ files }: { files: CodeExecutionFile[] }) {
  const { colors } = useTheme();
  const [saving, setSaving] = useState<string | null>(null);

  async function save(file: CodeExecutionFile) {
    setSaving(file.id);
    try {
      // Download first, so a failed request does not leave the folder picker open.
      const response = await authFetch(`${getApiBase()}${file.url}`);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const directory = await Directory.pickDirectoryAsync();
      directory.createFile(file.name, file.mediaType).write(bytes);
      toastSuccess("File saved");
    } catch (error) {
      if (!(error instanceof Error && /cancel/i.test(error.message)))
        toastError("Could not save file", error);
    } finally {
      setSaving(null);
    }
  }

  return (
    <View style={{ gap: 10, marginVertical: 8 }}>
      {files.map((file) => (
        <View key={file.id} style={{ gap: 2 }}>
          <AttachmentChip
            attachment={{
              type: "file",
              url: file.url,
              mediaType: file.mediaType,
              filename: file.name,
            }}
            meta={{ category: categoryOf(file), size: file.size }}
            large={isPreviewableImage(file)}
          />
          <Pressable
            disabled={saving !== null}
            accessibilityRole="button"
            accessibilityLabel={`Save ${file.name}`}
            onPress={() => void save(file)}
            style={{ alignSelf: "flex-start", paddingVertical: 8 }}
          >
            <Text style={{ color: colors.primary }}>
              {saving === file.id ? "Saving…" : "Save"}
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
