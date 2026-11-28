"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import {
  chatKeys,
  libraryKeys,
  personalizationKeys,
  projectKeys,
} from "@/lib/queries/keys";
import {
  SettingsNotice,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../SettingsRows";
import { apiUrl } from "@/lib/api-url";
import { SharedChats } from "./SharedChats";

type ImportResult = {
  format: string;
  importedChats: number;
  importedMessages: number;
  importedMemories: number;
};

const FORMAT_LABELS: Record<string, string> = {
  ours: "overtchat",
  chatgpt: "ChatGPT",
  claude: "Claude.ai",
  openwebui: "OpenWebUI",
};

export function DataForm() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  async function handleFile(file: File) {
    setImporting(true);
    setImportError("");

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch(apiUrl("/api/import"), { method: "POST", body: form });
      const body = (await res.json()) as ImportResult | { error?: string };
      if (!res.ok) {
        setImportError(
          (body as { error?: string }).error ??
            t("data.import.failedWithStatus", { status: res.status }),
        );
        return;
      }
      const result = body as ImportResult;
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: libraryKeys.all() });
      qc.invalidateQueries({ queryKey: projectKeys.list() });
      qc.invalidateQueries({ queryKey: personalizationKeys.all() });
      const format = FORMAT_LABELS[result.format] ?? result.format;
      toast.success({
        title: t("data.import.completeTitle"),
        description: result.importedMemories
          ? t("data.import.completeWithMemories", {
              chats: t("data.import.chatCount", { count: result.importedChats }),
              memories: t("data.import.memoryCount", {
                count: result.importedMemories,
              }),
              format,
            })
          : t("data.import.completeChats", {
              count: result.importedChats,
              format,
            }),
      });
    } catch (err) {
      setImportError(getErrorMessage(err, t("data.import.failed")));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t("data.title")}
        description={t("data.description")}
      />
      <SharedChats />

      <input
        ref={fileRef}
        type="file"
        accept=".json,.zip,application/json,application/zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      <SettingsSection
        title={t("data.import.title")}
        description={t("data.import.description")}
      >
        <SettingsRow
          title={t("data.import.fileTitle")}
          description={t("data.import.fileDescription")}
          align="center"
          controlAlign="end"
        >
          <div className="flex flex-col gap-2 @2xl:items-end @2xl:text-right">
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
            >
              <Upload data-icon="inline-start" />
              {importing ? t("data.import.importing") : t("data.import.chooseFile")}
            </Button>

            {importError && (
              <SettingsNotice tone="error">{importError}</SettingsNotice>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title={t("data.export.title")}
        description={t("data.export.description")}
      >
        <SettingsRow
          title={t("data.export.fileTitle")}
          description={t("data.export.fileDescription")}
          align="center"
          controlAlign="end"
        >
          <Button type="button" variant="outline" render={<a href={apiUrl("/api/export")} />}>
            <Download data-icon="inline-start" />
            {t("data.export.download")}
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
}
