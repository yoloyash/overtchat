"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chatKeys, projectKeys } from "@/lib/queries/keys";

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
      setImportResult(body as ImportResult);
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: projectKeys.list() });
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
    <div className="max-w-xl space-y-10">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Data
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Import chats from other platforms, or export your own.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">Import chats</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Supports ChatGPT, Claude.ai, OpenWebUI, and overtchat exports.
            Drop the downloaded JSON or ZIP; we&apos;ll detect the format.
          </p>
        </div>

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

        <div className="flex items-center gap-3">
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
            <span className="text-sm text-ring">
              Imported {importResult.importedChats} chat
              {importResult.importedChats === 1 ? "" : "s"} from{" "}
              {FORMAT_LABELS[importResult.format] ?? importResult.format}.
            </span>
          )}
        </div>

        {importError && (
          <p className="text-sm text-destructive">{importError}</p>
        )}

        <p className="text-xs text-muted-foreground">
          Attachments, images, and branches aren&apos;t preserved — only text
          and reasoning from the visible conversation.
        </p>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">Export all chats</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Downloads every conversation as a single JSON file. Lossless
            round-trip — re-import with the &ldquo;Choose file&rdquo; button above.
          </p>
        </div>
        <Button type="button" variant="outline" render={<a href="/api/export" />}>
          <Download data-icon="inline-start" />
          Download export
        </Button>
      </section>
    </div>
  );
}
