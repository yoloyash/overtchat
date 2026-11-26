"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import {
  documentFilename,
  documentMediaType,
  type DocumentOutput,
} from "@overtchat/shared";
import { FolderCheck, FolderPlus, Loader2 } from "lucide-react";
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
  className,
}: {
  source: SaveToProjectSource;
  disabled?: boolean;
  className?: string;
}) {
  const target = useProjectSaveTarget();
  if (!target) return null;
  if (source.kind === "file") {
    if (source.file.mediaType.startsWith("image/")) return null;
    if (!UPLOAD_URL.test(source.file.url)) return null;
  }
  return (
    <SaveButton
      source={source}
      target={target}
      disabled={disabled}
      className={className}
    />
  );
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
  className,
}: {
  source: SaveToProjectSource;
  target: ProjectSaveTarget;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { data: files } = useProjectFiles(target.project.id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const filename = sourceFilename(source);
  const existing = files?.find(
    (file) => file.filename.toLowerCase() === filename.toLowerCase(),
  );
  // A conversation file is in the project when its upload is linked; a
  // document, which uploads on save, when a file carries its name.
  const inProject =
    source.kind === "file"
      ? files?.some((file) => file.url === source.file.url) ?? false
      : existing !== undefined;

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
    if (!r.ok || !json.url) {
      throw new Error(
        json.error ?? t("projects.saveToProject.errors.uploadFailed", { status: r.status }),
      );
    }
    return json.url.slice(json.url.lastIndexOf("/") + 1);
  }

  async function save(mode: "add" | "replace") {
    setConflictOpen(false);
    setSaving(true);
    try {
      const id = await uploadId();
      if (existing && existing.uploadId === id) {
        toast.success({
          title: t("projects.saveToProject.toast.alreadyInProject", {
            project: target.project.name,
          }),
          description: filename,
        });
        return;
      }
      await linkProjectFile(target.project.id, { uploadId: id, sourceChatId: target.chatId });
      if (mode === "replace" && existing) {
        await unlinkProjectFile(target.project.id, existing.uploadId);
      }
      toast.success({
        title: t("projects.saveToProject.toast.savedToProject", {
          project: target.project.name,
        }),
        description: filename,
        action: {
          label: t("projects.saveToProject.toast.openProject"),
          onClick: () => void navigate({ to: "/projects/$id", params: { id: target.project.id } }),
        },
      });
    } catch (err) {
      toast.error({
        title: t("projects.saveToProject.toast.saveError", { filename }),
        description: getErrorMessage(err, t("projects.saveToProject.errors.saveFallback")),
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
        aria-label={
          inProject
            ? t("projects.saveToProject.inProject")
            : t("projects.saveToProject.saveToProject")
        }
        title={
          inProject
            ? t("projects.saveToProject.inProjectTitle", {
                project: target.project.name,
              })
            : t("projects.saveToProject.saveToProjectTitle", {
                project: target.project.name,
              })
        }
        className={className}
        disabled={disabled || saving || !files}
        onClick={() => {
          if (existing && !(source.kind === "file" && existing.url === source.file.url)) {
            setConflictOpen(true);
          } else {
            void save("add");
          }
        }}
      >
        {saving ? (
          <Loader2 className={motionClasses.spinner} />
        ) : inProject ? (
          <FolderCheck />
        ) : (
          <FolderPlus />
        )}
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
              {t("projects.saveToProject.conflictDialog.title", { filename })}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <Trans
                i18nKey="projects.saveToProject.conflictDialog.description"
                values={{ project: target.project.name }}
                components={{
                  project: <span className="font-medium text-foreground" />,
                }}
              />
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close render={<Button variant="ghost" size="sm" />}>
                {t("common.actions.cancel")}
              </AlertDialog.Close>
              <Button variant="outline" size="sm" onClick={() => void save("add")}>
                {t("projects.saveToProject.conflictDialog.keepBoth")}
              </Button>
              <Button size="sm" onClick={() => void save("replace")}>
                {t("projects.saveToProject.conflictDialog.replace")}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
