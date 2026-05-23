"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateProject } from "@/lib/queries/projects";
import {
  SidebarItem,
  type ProjectOption,
} from "@/components/SidebarChatList";

interface ProjectWithChats extends ProjectOption {
  chats: { id: string; title: string | null }[];
}

export function SidebarProjects({
  projects,
}: {
  projects: ProjectWithChats[];
}) {
  const projectOptions: ProjectOption[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
  }));

  if (projects.length === 0) return null;

  return (
    <ul className="flex flex-col gap-0.5">
      {projects.map((p) => (
        <ProjectNode
          key={p.id}
          project={p}
          projectOptions={projectOptions}
        />
      ))}
    </ul>
  );
}

function ProjectNode({
  project,
  projectOptions,
}: {
  project: ProjectWithChats;
  projectOptions: ProjectOption[];
}) {
  const pathname = usePathname();
  const active = pathname === `/projects/${project.id}`;
  const hasActiveChat = project.chats.some(
    (c) => pathname === `/chat/${c.id}`,
  );
  const [open, setOpen] = useState(hasActiveChat);

  return (
    <li>
      <div className="group flex items-center">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse" : "Expand"}
          className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent max-md:p-2"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-90",
            )}
          />
        </button>
        <Link
          href={`/projects/${project.id}`}
          className={cn(
            "flex-1 truncate rounded-md px-1 py-1 text-sm hover:bg-sidebar-accent",
            active && "bg-sidebar-accent",
          )}
        >
          {project.name}
        </Link>
        <Link
          href={`/?projectId=${project.id}`}
          aria-label={`New chat in ${project.name}`}
          className="mr-0.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground group-hover:opacity-100 max-md:p-2 [@media(hover:none)]:opacity-100"
        >
          <Plus className="size-3.5" />
        </Link>
      </div>
      {open && (
        <ul className="ml-5 flex flex-col gap-0.5 border-l pl-1">
          {project.chats.length === 0 ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              No chats yet
            </li>
          ) : (
            project.chats.map((c) => (
              <SidebarItem
                key={c.id}
                chat={c}
                projects={projectOptions}
                currentProjectId={project.id}
              />
            ))
          )}
        </ul>
      )}
    </li>
  );
}

export function CreateProjectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const createMut = useCreateProject();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function reset() {
    setName("");
    setError("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    createMut.mutate(
      { name: trimmed },
      {
        onSuccess: ({ id }) => {
          reset();
          onClose();
          router.push(`/projects/${id}`);
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : String(err));
        },
      },
    );
  }

  const pending = createMut.isPending;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg outline-none transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">
          <Dialog.Title className="font-heading text-lg font-semibold tracking-tight">
            New project
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Give it a name. You can add instructions after creating it.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Work — weekly review"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
