import { isPreviewableImage, type CodeExecutionFile } from "@overtchat/shared";
import { Directory } from "expo-file-system";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type TextStyle } from "react-native";
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

/** Saves a run's file to a folder the user picks. */
function useSaveFile() {
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

  return { saving, save };
}

/**
 * Files code runs returned, each with a save action. Images open full screen
 * when tapped; `large` shows them at full width, as replies do.
 */
export function CodeExecutionFiles({
  files,
  large = false,
}: {
  files: CodeExecutionFile[];
  large?: boolean;
}) {
  const { colors } = useTheme();
  const { saving, save } = useSaveFile();

  return (
    <View style={{ gap: 10, marginVertical: large ? 8 : 4 }}>
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
            large={large && isPreviewableImage(file)}
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

/** A reply's link to a run's file inside a sentence: tapping saves the file. */
export function CodeFileLinkText({
  file,
  style,
  children,
}: {
  file: CodeExecutionFile;
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
}) {
  const { saving, save } = useSaveFile();
  return (
    <Text
      style={style}
      accessibilityRole="link"
      accessibilityHint={`Saves ${file.name}`}
      onPress={saving === null ? () => void save(file) : undefined}
    >
      {children}
    </Text>
  );
}
