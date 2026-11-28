import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      throw new Error(
        t("data.mobile.export.failedWithStatus", { status: response.status }),
      );
    const file = directory.createFile(
      `overtchat-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      "application/json",
    );
    file.write(new Uint8Array(await response.arrayBuffer()));
    setResult(t("data.mobile.export.saved"));
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
      throw new Error(t("data.mobile.import.tooLarge"));
    Alert.alert(
      t("data.mobile.import.confirmTitle"),
      t("data.mobile.import.confirmMessage", { name: selected.name }),
      [
        { text: t("common.actions.cancel"), style: "cancel" },
        {
          text: t("data.import.title"),
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
                  throw new Error(data.error ?? t("data.import.failed"));
                await Promise.all([
                  client.invalidateQueries({ queryKey: queryKeys.chats() }),
                  client.invalidateQueries({ queryKey: queryKeys.projects() }),
                  client.invalidateQueries({
                    queryKey: queryKeys.personalization(),
                  }),
                ]);
                setResult(
                  t("data.mobile.import.complete", {
                    chats: t("data.import.chatCount", {
                      count: data.importedChats,
                    }),
                    messages: t("data.mobile.import.messageCount", {
                      count: data.importedMessages,
                    }),
                    memories: t("data.import.memoryCount", {
                      count: data.importedMemories,
                    }),
                  }),
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
    <SettingsPage title={t("settings.mobile.index.dataAndBackups")}>
      <Section
        title={t("data.export.title")}
        description={t("data.mobile.export.description")}
      >
        <Row
          title={
            action.busy
              ? t("common.states.working")
              : t("data.mobile.export.action")
          }
          icon="download-outline"
          disabled={action.busy}
          onPress={() => void action.run(exportData)}
        />
      </Section>
      <Section
        title={t("data.import.title")}
        description={t("data.mobile.import.description")}
      >
        <Row
          title={t("data.mobile.import.chooseFile")}
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
