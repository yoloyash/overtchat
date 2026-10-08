import { useState } from "react";
import { Alert } from "react-native";
import { Directory, File } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import { useQueryClient } from "@tanstack/react-query";
import {
  SettingsPage,
  Section,
  Row,
  Label,
  useAction,
} from "@/components/settings/SettingsUI";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";
export default function Data() {
  const action = useAction();
  const [result, setResult] = useState("");
  const client = useQueryClient();
  async function exportData() {
    setResult("");
    let directory: Directory;
    try {
      directory = await Directory.pickDirectoryAsync();
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) return;
      throw error;
    }
    const response = await authFetch(`${getApiBase()}/api/export`);
    if (!response.ok)
      throw new Error(`Couldn’t export chats (${response.status}).`);
    const file = directory.createFile(
      `overtchat-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      "application/json",
    );
    file.write(new Uint8Array(await response.arrayBuffer()));
    setResult("Export saved to the selected folder.");
  }
  async function selectImport() {
    const selection = await DocumentPicker.getDocumentAsync({
      type: [
        "application/json",
        "application/zip",
        "application/x-zip-compressed",
      ],
      copyToCacheDirectory: true,
    });
    if (selection.canceled) return;
    const selected = selection.assets[0];
    if ((selected.size ?? 0) > 50 * 1024 * 1024)
      throw new Error("Import files must be 50 MB or smaller.");
    Alert.alert(
      "Import chats?",
      `Import ${selected.name} into your account? Importing the same file again may create duplicates.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Import",
          onPress: () =>
            void action.run(async () => {
              setResult("");
              const file = new File(selected.uri);
              const form = new FormData();
              form.append("file", file as unknown as Blob, selected.name);
              try {
                const response = await authFetch(`${getApiBase()}/api/import`, {
                  method: "POST",
                  body: form,
                });
                const data = (await response.json()) as {
                  error?: string;
                  importedChats: number;
                  importedMessages: number;
                  importedMemories: number;
                };
                if (!response.ok)
                  throw new Error(data.error ?? "Import failed.");
                await Promise.all([
                  client.invalidateQueries({ queryKey: queryKeys.chats() }),
                  client.invalidateQueries({ queryKey: queryKeys.projects() }),
                  client.invalidateQueries({
                    queryKey: queryKeys.personalization(),
                  }),
                ]);
                setResult(
                  `Imported ${data.importedChats} chat${data.importedChats === 1 ? "" : "s"}, ${data.importedMessages} message${data.importedMessages === 1 ? "" : "s"}, and ${data.importedMemories} memor${data.importedMemories === 1 ? "y" : "ies"}.`,
                );
              } finally {
                if (file.exists) file.delete();
              }
            }),
        },
      ],
    );
  }
  return (
    <SettingsPage title="Data & backups">
      <Section
        title="Export"
        description="Save your chats as an OvertChat JSON file for backup or re-import."
      >
        <Row
          title={action.busy ? "Working…" : "Export chats"}
          icon="download-outline"
          disabled={action.busy}
          onPress={() => void action.run(exportData)}
        />
      </Section>
      <Section
        title="Import"
        description="ChatGPT, Claude.ai, OpenWebUI, and OvertChat JSON or ZIP exports, up to 50 MB. Visible text and reasoning are preserved; attachments, images, and branches are not imported."
      >
        <Row
          title="Choose import file"
          icon="push-outline"
          disabled={action.busy}
          onPress={() => void action.run(selectImport)}
        />
      </Section>
      {action.error && <Label error>{action.error}</Label>}
      {result && <Label>{result}</Label>}
    </SettingsPage>
  );
}
