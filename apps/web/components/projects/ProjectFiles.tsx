"use client";

import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { CategoryIcon } from "@/components/chat/attachment-icons";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  DOCUMENT_ACCEPT,
  formatSize,
  humanMediaLabel,
  isSupportedDocument,
  unsupportedAttachmentMessage,
} from "@/lib/chat/attachments";
import { getErrorMessage } from "@/lib/errors";
import { MAX_PROJECT_FILES } from "@/lib/project-files";
import {
  type ProjectFileItem,
  useAddProjectFile,
  useProjectFiles,
  useRemoveProjectFile,
} from "@/lib/queries/project-files";
import { serverUrl } from "@/lib/api-url";
import { cn } from "@/lib/utils";

/**
 * Reference files every chat in the project can read. Files upload through
 * the attachment route and link to the project; the model reaches them with
 * the file tools rather than through the conversation.
 */
export function ProjectFilesCard({
  projectId,
  className,
}: {
  projectId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { data: files, isError, refetch } = useProjectFiles(projectId);
  const addMut = useAddProjectFile(projectId);
  const removeMut = useRemoveProjectFile(projectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);

  const count = files?.length ?? 0;
  const full = count + uploading.length >= MAX_PROJECT_FILES;

  async function addFiles(chosen: File[]) {
    const room = MAX_PROJECT_FILES - count - uploading.length;
    if (chosen.length > room) {
      toast.error({
        title: t("projects.files.toast.limitTitle", { count: MAX_PROJECT_FILES }),
        description:
          room > 0
            ? t("projects.files.toast.limitPartial", { count: room })
            : t("projects.files.toast.limitFull"),
      });
    }
    const accepted: File[] = [];
    for (const file of chosen.slice(0, Math.max(room, 0))) {
      if (!isSupportedDocument(file)) {
        toast.error(unsupportedAttachmentMessage(file));
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;
    setUploading((prev) => [...prev, ...accepted.map((file) => file.name)]);
    for (const file of accepted) {
      try {
        await addMut.mutateAsync(file);
      } catch (err) {
        toast.error({
          title: t("projects.files.toast.addError", { filename: file.name }),
          description: getErrorMessage(err, t("projects.files.errors.addFallback")),
        });
      } finally {
        setUploading((prev) => {
          const index = prev.indexOf(file.name);
          return index < 0 ? prev : prev.filter((_, i) => i !== index);
        });
      }
    }
  }

  function remove(file: ProjectFileItem) {
    removeMut.mutate(file.uploadId, {
      onError: (err) => {
        toast.error({
          title: t("projects.files.toast.removeError", { filename: file.filename }),
          description: getErrorMessage(err, t("projects.files.errors.removeFallback")),
        });
      },
    });
  }

  return (
    <section
      aria-label={t("projects.files.sectionLabel")}
      className={cn("rounded-xl border bg-card/40 p-4", className)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{t("projects.files.title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("projects.files.description")}
          </p>
        </div>
        {count > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("projects.files.addFiles")}
            title={t("projects.files.addFiles")}
            disabled={full}
            onClick={() => inputRef.current?.click()}
          >
            <Plus />
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={DOCUMENT_ACCEPT}
        aria-label={t("projects.files.inputLabel")}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          // Copy first: clearing the input empties its live FileList.
          const chosen = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (chosen.length) void addFiles(chosen);
        }}
      />
      <div className="mt-3">
        {isError ? (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("projects.files.loadError")}</span>
            <Button variant="ghost" size="sm" onClick={() => void refetch()}>
              {t("common.actions.tryAgain")}
            </Button>
          </div>
        ) : count === 0 && uploading.length === 0 ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => inputRef.current?.click()}
          >
            <Plus /> {t("projects.files.addFiles")}
          </Button>
        ) : (
          <ul aria-label={t("projects.files.title")} className="max-h-80 space-y-0.5 overflow-y-auto">
            {files?.map((file) => (
              <li
                key={file.uploadId}
                className="group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 motion-colors hover:bg-accent/60"
              >
                <CategoryIcon
                  category={file.category}
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <a
                  href={serverUrl(file.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1"
                  title={file.filename}
                >
                  <span className="block truncate text-sm">{file.filename}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {humanMediaLabel(file.mediaType, t)} · {formatSize(file.size, t)}
                    {file.pageCount
                      ? ` · ${t("projects.files.pages", { count: file.pageCount })}`
                      : ""}
                    {file.sourceChat && (
                      <>
                        {" · "}
                        {file.sourceChat.title != null ? (
                          <Trans
                            i18nKey="projects.files.fromChat"
                            values={{ chat: file.sourceChat.title }}
                            components={{
                              chatLink: (
                                <Link
                                  to="/chat/$id"
                                  params={{ id: file.sourceChat.id }}
                                  className="underline-offset-2 hover:underline"
                                />
                              ),
                            }}
                          />
                        ) : (
                          <Trans
                            i18nKey="projects.files.fromUnnamedChat"
                            components={{
                              chatLink: (
                                <Link
                                  to="/chat/$id"
                                  params={{ id: file.sourceChat.id }}
                                  className="underline-offset-2 hover:underline"
                                />
                              ),
                            }}
                          />
                        )}
                      </>
                    )}
                  </span>
                </a>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("projects.files.removeFileLabel", { filename: file.filename })}
                  title={t("projects.actions.removeFromProject")}
                  className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  disabled={removeMut.isPending}
                  onClick={() => remove(file)}
                >
                  <X />
                </Button>
              </li>
            ))}
            {uploading.map((name, index) => (
              <li
                key={`uploading-${index}-${name}`}
                className="flex min-w-0 items-center gap-2 px-1.5 py-1 text-sm text-muted-foreground"
                aria-busy="true"
              >
                <CategoryIcon category={undefined} className="size-4 shrink-0" />
                <span className="truncate">{name}</span>
                <span className="ml-auto shrink-0 text-xs">{t("common.states.uploading")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {count > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("projects.files.footer", { used: count, max: MAX_PROJECT_FILES })}
        </p>
      )}
    </section>
  );
}
