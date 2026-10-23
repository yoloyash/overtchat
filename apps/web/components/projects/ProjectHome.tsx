"use client";

import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Menu } from "@base-ui/react/menu";
import { FolderOpen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  type ProjectListItem,
  useDeleteProject,
  useProject,
  useUpdateProject,
} from "@/lib/queries/projects";
import { ProjectChatList } from "./ProjectChatList";
import { ProjectInstructionsCard, ProjectModelCard } from "./ProjectSettings";

/**
 * A project's page: start a chat in it, browse its chats, and edit the
 * instructions and default model they share.
 */
export function ProjectHome({
  projectId,
  composer,
  onDefaultModelChange,
}: {
  projectId: string;
  composer: ReactNode;
  onDefaultModelChange: (modelId: string) => void;
}) {
  const { data: project } = useProject(projectId);

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pt-8 pb-[max(3rem,env(safe-area-inset-bottom))] md:px-8 md:pt-14">
        <div
          className={cn(
            "grid gap-x-10 gap-y-8",
            "[grid-template-areas:'title'_'composer'_'settings'_'chats']",
            "lg:grid-cols-[minmax(0,1fr)_18rem] lg:[grid-template-areas:'title_title'_'composer_settings'_'chats_settings'] lg:grid-rows-[auto_auto_1fr]",
          )}
        >
          <div className="[grid-area:title]">
            <ProjectTitle project={project} />
          </div>
          <div className="min-w-0 [grid-area:composer]">{composer}</div>
          <aside
            aria-label="Project settings"
            className="flex flex-col gap-3 [grid-area:settings] lg:self-start"
          >
            <ProjectInstructionsCard key={project.id} project={project} />
            <ProjectModelCard
              project={project}
              onDefaultModelChange={onDefaultModelChange}
            />
          </aside>
          <div className="min-w-0 [grid-area:chats]">
            <ProjectChatList projectId={project.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectTitle({ project }: { project: ProjectListItem }) {
  const navigate = useNavigate();
  const updateMut = useUpdateProject(project.id);
  const deleteMut = useDeleteProject();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  function startRename() {
    setName(project.name);
    setRenaming(true);
  }

  function commitRename() {
    const next = name.trim();
    setRenaming(false);
    if (!next || next === project.name) return;
    updateMut.mutate(
      { name: next },
      {
        onError: (err) => {
          toast.error({
            title: "Failed to rename project",
            description: getErrorMessage(err, "The project name was not changed."),
          });
        },
      },
    );
  }

  async function confirmDelete() {
    setDeleteError("");
    try {
      await deleteMut.mutateAsync(project.id);
      setDeleteOpen(false);
      toast.success({
        title: "Project deleted",
        description: "Chats from the project moved to your main list.",
      });
      void navigate({ to: "/" });
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Failed to delete project."));
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/50 text-muted-foreground">
        <FolderOpen className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            aria-label="Project name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setName(project.name);
                setRenaming(false);
              }
            }}
            className="-ml-1.5 w-full max-w-md rounded-md border bg-background px-1.5 py-0.5 text-2xl font-semibold tracking-tight outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
          />
        ) : (
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            <button
              type="button"
              onClick={startRename}
              title="Rename project"
              className="-ml-1.5 max-w-full truncate rounded-md px-1.5 py-0.5 text-left motion-colors hover:bg-accent"
            >
              {project.name}
            </button>
          </h1>
        )}
      </div>
      <Menu.Root>
        <Menu.Trigger
          aria-label="Project actions"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground motion-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent"
        >
          <MoreHorizontal className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={6}>
            <Menu.Popup
              className={cn(
                "z-50 w-44 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                motionClasses.popup,
              )}
            >
              <Menu.Item
                onClick={startRename}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
                <span>Rename</span>
              </Menu.Item>
              <Menu.Item
                onClick={() => {
                  setDeleteError("");
                  setDeleteOpen(true);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-destructive outline-none motion-colors data-[highlighted]:bg-accent"
              >
                <Trash2 className="size-3.5 shrink-0" />
                <span>Delete project</span>
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <AlertDialog.Root
        open={deleteOpen}
        onOpenChange={(next) => {
          if (next) {
            setDeleteOpen(true);
          } else if (!deleteMut.isPending) {
            setDeleteOpen(false);
            setDeleteError("");
          }
        }}
      >
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
              Delete project?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {project.name}
              </span>{" "}
              will be deleted. Chats inside it will move to your main list.
            </AlertDialog.Description>
            {deleteError && (
              <p className="mt-3 text-xs text-destructive">{deleteError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteMut.isPending}
                  />
                }
              >
                Cancel
              </AlertDialog.Close>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={confirmDelete}
              >
                {deleteMut.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
