"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { chatKeys, projectKeys } from "@/lib/queries/keys";
import {
  SettingsNotice,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../_components/SettingsRows";

type ImportResult = {
  format: string;
  importedChats: number;
  importedMessages: number;
};

const FORMAT_LABELS: Record<string, string> = {
  ours: "overtchat",
  chatgpt: "ChatGPT",
  claude: "Claude.ai",
  openwebui: "OpenWebUI",
};

export function DataForm() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState("");

  async function handleFile(file: File) {
    setImporting(true);
    setImportResult(null);
    setImportError("");

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/import", { method: "POST", body: form });
      const body = (await res.json()) as ImportResult | { error?: string };
      if (!res.ok) {
        setImportError(
          (body as { error?: string }).error ?? `Import failed (${res.status})`,
        );
        return;
      }
      const result = body as ImportResult;
      setImportResult(result);
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: projectKeys.list() });
      toast.success({
        title: "Import complete",
        description: `Imported ${result.importedChats} chat${
          result.importedChats === 1 ? "" : "s"
        } from ${FORMAT_LABELS[result.format] ?? result.format}.`,
      });
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Import failed.",
      );
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <SettingsPageHeader
        title="Data"
        description="Import chats from other platforms, or export your own."
      />

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
        title="Import"
        description="Supports ChatGPT, Claude.ai, OpenWebUI, and overtchat exports."
      >
        <SettingsRow
          title="Import file"
          description="Choose a downloaded JSON or ZIP file. Imports preserve visible chat text and reasoning, but not attachments, images, or branches."
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
              {importing ? "Importing…" : "Choose file"}
            </Button>

            {importResult && (
              <SettingsNotice tone="success">
                Imported {importResult.importedChats} chat
                {importResult.importedChats === 1 ? "" : "s"} from{" "}
                {FORMAT_LABELS[importResult.format] ?? importResult.format}.
              </SettingsNotice>
            )}

            {importError && (
              <SettingsNotice tone="error">{importError}</SettingsNotice>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Export"
        description="Download every chat as a single overtchat JSON file."
      >
        <SettingsRow
          title="Export file"
          description="Use this file for backup or a lossless re-import."
          align="center"
          controlAlign="end"
        >
          <Button type="button" variant="outline" render={<a href="/api/export" />}>
            <Download data-icon="inline-start" />
            Download export
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
