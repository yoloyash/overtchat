"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  documentFilename,
  documentMediaType,
  type DocumentOutput,
} from "@overtchat/shared";
import { FolderPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { apiUrl } from "@/lib/api-url";
import { getErrorMessage } from "@/lib/errors";
import { motionClasses } from "@/lib/motion";
import { projectKeys } from "@/lib/queries/keys";
import {
  linkProjectFile,
  unlinkProjectFile,
  useProjectFiles,
} from "@/lib/queries/project-files";
import { cn } from "@/lib/utils";
import { useProjectSaveTarget, type ProjectSaveTarget } from "./ProjectSaveContext";

export type SaveToProjectSource =
  | {
      kind: "document";
      document: Pick<DocumentOutput, "title" | "type" | "language" | "content">;
    }
  | { kind: "file"; file: { url: string; name: string; mediaType: string } };

const UPLOAD_URL = /^\/api\/uploads\/([a-zA-Z0-9_-]+)$/;

/**
 * Files a document or conversation file into the chat's project, where every
 * chat in the project can read it. Shown only inside a project chat, and not
 * for images, which the file tools cannot read.
 */
export function SaveToProjectButton({
  source,
  disabled,
}: {
  source: SaveToProjectSource;
  disabled?: boolean;
}) {
  const target = useProjectSaveTarget();
  if (!target) return null;
  if (source.kind === "file") {
    if (source.file.mediaType.startsWith("image/")) return null;
    if (!UPLOAD_URL.test(source.file.url)) return null;
  }
  return <SaveButton source={source} target={target} disabled={disabled} />;
}

function sourceFilename(source: SaveToProjectSource): string {
  return source.kind === "document"
    ? documentFilename(source.document)
    : source.file.name;
}

function SaveButton({
  source,
  target,
  disabled,
}: {
  source: SaveToProjectSource;
  target: ProjectSaveTarget;
  disabled?: boolean;
}) {
  const { data: files } = useProjectFiles(target.project.id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const filename = sourceFilename(source);
  const existing = files?.find(
    (file) => file.filename.toLowerCase() === filename.toLowerCase(),
  );

  async function uploadId(): Promise<string> {
    if (source.kind === "file") return UPLOAD_URL.exec(source.file.url)![1];
    const form = new FormData();
    form.append(
      "file",
      new File([source.document.content], filename, {
        type: documentMediaType(source.document),
      }),
    );
    const r = await fetch(apiUrl("/api/uploads"), { method: "POST", body: form });
    const json = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!r.ok || !json.url) throw new Error(json.error ?? `Upload failed (${r.status})`);
    return json.url.slice(json.url.lastIndexOf("/") + 1);
  }

  async function save(mode: "add" | "replace") {
    setConflictOpen(false);
    setSaving(true);
    try {
      const id = await uploadId();
      if (existing && existing.uploadId === id) {
        toast.success({
          title: `Already in ${target.project.name}`,
          description: filename,
        });
        return;
      }
      await linkProjectFile(target.project.id, { uploadId: id, sourceChatId: target.chatId });
      if (mode === "replace" && existing) {
        await unlinkProjectFile(target.project.id, existing.uploadId);
      }
      toast.success({
        title: `Saved to ${target.project.name}`,
        description: filename,
        action: {
          label: "Open project",
          onClick: () => void navigate({ to: "/projects/$id", params: { id: target.project.id } }),
        },
      });
    } catch (err) {
      toast.error({
        title: `Could not save ${filename}`,
        description: getErrorMessage(err, "The file was not added to the project."),
      });
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ queryKey: projectKeys.files(target.project.id) });
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Save to project"
        title={`Save to ${target.project.name}`}
        disabled={disabled || saving || !files}
        onClick={() => {
          if (existing && !(source.kind === "file" && existing.url === source.file.url)) {
            setConflictOpen(true);
          } else {
            void save("add");
          }
        }}
      >
        {saving ? <Loader2 className={motionClasses.spinner} /> : <FolderPlus />}
      </Button>
      <AlertDialog.Root open={conflictOpen} onOpenChange={setConflictOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className={cn("fixed inset-0 z-50 bg-black/40", motionClasses.overlay)}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              Replace {filename}?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{target.project.name}</span>{" "}
              already has a file with this name. Replacing keeps past chats as they
              are; keeping both gives the new file a numbered name.
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close render={<Button variant="ghost" size="sm" />}>
                Cancel
              </AlertDialog.Close>
              <Button variant="outline" size="sm" onClick={() => void save("add")}>
                Keep both
              </Button>
              <Button size="sm" onClick={() => void save("replace")}>
                Replace
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
