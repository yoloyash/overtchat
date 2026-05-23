"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarToggle } from "@/components/SidebarToggle";
import { useChats } from "@/lib/queries/chats";
import {
  useDeleteProject,
  useProject,
  useUpdateProject,
} from "@/lib/queries/projects";

export function ProjectPanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { data: project } = useProject(projectId);
  const { data: chats = [] } = useChats();
  const updateMut = useUpdateProject(projectId);
  const deleteMut = useDeleteProject();

  const savedInstructions = project?.instructions ?? "";
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project?.name ?? "");
  const [instructionsDraft, setInstructionsDraft] = useState<string | null>(
    null,
  );

  // Reset the draft when the saved value changes (after save, or when switching projects).
  // See React docs on resetting state when a prop changes.
  const [draftBaseline, setDraftBaseline] = useState(savedInstructions);
  if (savedInstructions !== draftBaseline) {
    setDraftBaseline(savedInstructions);
    setInstructionsDraft(null);
  }

  const instructions = instructionsDraft ?? savedInstructions;
  const dirty = instructionsDraft !== null && instructionsDraft !== savedInstructions;

  const projectChats = useMemo(
    () => chats.filter((c) => c.projectId === projectId),
    [chats, projectId],
  );

  function startRename() {
    if (!project) return;
    setName(project.name);
    setRenaming(true);
  }

  function commitRename() {
    if (!project) return;
    const next = name.trim();
    setRenaming(false);
    if (!next || next === project.name) return;
    updateMut.mutate({ name: next });
  }

  function saveInstructions() {
    if (instructionsDraft === null) return;
    const value = instructionsDraft;
    updateMut.mutate(
      { instructions: value.trim() ? value : null },
      { onSuccess: () => setInstructionsDraft(null) },
    );
  }

  function confirmDelete() {
    if (!project) return;
    if (
      !window.confirm(
        `Delete "${project.name}"? Chats inside it will move to the main list.`,
      )
    ) {
      return;
    }
    deleteMut.mutate(project.id, {
      onSuccess: () => router.push("/"),
    });
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <SidebarToggle />
        {renaming ? (
          <input
            autoFocus
            value={name}
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
            className="max-w-xs rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
          />
        ) : (
          <button
            type="button"
            onClick={startRename}
            className="truncate rounded-md px-1 py-0.5 text-sm font-semibold tracking-tight hover:bg-accent"
            title="Rename"
          >
            {project.name}
          </button>
        )}
        <div className="flex-1" />
        <Menu.Root>
          <Menu.Trigger
            aria-label="Project actions"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={6}>
              <Menu.Popup className="z-50 w-44 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none">
                <Menu.Item
                  onClick={startRename}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
                  <span>Rename</span>
                </Menu.Item>
                <Menu.Item
                  onClick={confirmDelete}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-destructive outline-none data-[highlighted]:bg-accent"
                >
                  <Trash2 className="size-3.5 shrink-0" />
                  <span>Delete project</span>
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 md:px-8">
          <section className="space-y-3">
            <div>
              <h2 className="font-heading text-base font-semibold tracking-tight">
                Instructions
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Prepended to every chat in this project.
              </p>
            </div>
            <textarea
              rows={8}
              value={instructions}
              onChange={(e) => setInstructionsDraft(e.target.value)}
              placeholder="e.g. Always respond in concise bullet points. Assume the reader is a senior engineer."
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={saveInstructions}
                disabled={!dirty || updateMut.isPending}
              >
                {updateMut.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-base font-semibold tracking-tight">
                Chats
              </h2>
              <Button
                size="sm"
                render={<Link href={`/?projectId=${project.id}`} />}
              >
                <Plus /> New chat
              </Button>
            </div>
            {projectChats.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No chats yet. Click “New chat” to start one in this project.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {projectChats.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/chat/${c.id}`}
                      className="block truncate px-3 py-2.5 text-sm hover:bg-accent"
                    >
                      {c.title ?? "Untitled"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
