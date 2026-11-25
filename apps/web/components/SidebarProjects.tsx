"use client";

import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useTranslation } from "react-i18next";
import { ChevronRight, Plus } from "lucide-react";
import type { ChatKind } from "@overtchat/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import { motionClasses } from "@/lib/motion";
import { useCreateProject } from "@/lib/queries/projects";
import {
  SidebarItem,
  type ProjectOption,
} from "@/components/SidebarChatList";
import { useSidebar } from "@/components/sidebar-context";

interface ProjectWithChats extends ProjectOption {
  chats: {
    id: string;
    title: string | null;
    kind: ChatKind;
    pinned?: boolean;
    scheduledTaskName?: string;
  }[];
}

export function SidebarProjects({
  projects,
  activeChatIds,
  unreadChatIds,
  pinningSupported,
}: {
  projects: ProjectWithChats[];
  activeChatIds: ReadonlySet<string>;
  unreadChatIds: ReadonlySet<string>;
  pinningSupported: boolean;
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
          activeChatIds={activeChatIds}
          unreadChatIds={unreadChatIds}
          pinningSupported={pinningSupported}
        />
      ))}
    </ul>
  );
}

function ProjectNode({
  project,
  projectOptions,
  activeChatIds,
  unreadChatIds,
  pinningSupported,
}: {
  project: ProjectWithChats;
  projectOptions: ProjectOption[];
  activeChatIds: ReadonlySet<string>;
  unreadChatIds: ReadonlySet<string>;
  pinningSupported: boolean;
}) {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { closeMobile } = useSidebar();
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
          aria-label={open ? t("sidebar.projects.collapse") : t("sidebar.projects.expand")}
          className="rounded p-1 text-muted-foreground motion-colors hover:bg-sidebar-accent max-md:p-2"
        >
          <ChevronRight
            className={cn(
              "size-3.5 motion-transform",
              open && "rotate-90",
            )}
          />
        </button>
        <Link
          to="/projects/$id"
          params={{ id: project.id }}
          onClick={closeMobile}
          className={cn(
            "flex-1 truncate rounded-md px-1 py-1 text-sm motion-colors hover:bg-sidebar-accent",
            active && "bg-sidebar-accent",
          )}
        >
          {project.name}
        </Link>
        <Link
          to="/"
          search={{ projectId: project.id }}
          onClick={closeMobile}
          aria-label={t("sidebar.projects.newChatIn", { name: project.name })}
          className={cn(
            "mr-0.5 rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground max-md:p-2",
            motionClasses.hoverReveal,
          )}
        >
          <Plus className="size-3.5" />
        </Link>
      </div>
      {open && (
        <ul className="ml-5 flex flex-col gap-0.5 border-l pl-1">
          {project.chats.length === 0 ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              {t("sidebar.projects.noChatsYet")}
            </li>
          ) : (
            project.chats.map((c) => (
              <SidebarItem
                key={c.id}
                chat={c}
                projects={projectOptions}
                currentProjectId={project.id}
                generating={activeChatIds.has(c.id)}
                unread={unreadChatIds.has(c.id)}
                pinningSupported={pinningSupported}
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
  const { t } = useTranslation();
  const navigate = useNavigate();
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
      setError(t("sidebar.projects.createDialog.nameRequired"));
      return;
    }
    createMut.mutate(
      { name: trimmed },
      {
        onSuccess: ({ id }) => {
          reset();
          onClose();
          toast.success({
            title: t("sidebar.projects.createDialog.createdTitle"),
            description: trimmed,
          });
          void navigate({ to: "/projects/$id", params: { id } });
        },
        onError: (err) => {
          setError(getErrorMessage(err, t("sidebar.projects.createDialog.createError")));
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
        <Dialog.Backdrop
          className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {t("sidebar.projects.createDialog.title")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {t("sidebar.projects.createDialog.description")}
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">{t("sidebar.projects.createDialog.nameLabel")}</Label>
              <Input
                id="project-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("sidebar.projects.createDialog.namePlaceholder")}
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
                {t("sidebar.projects.createDialog.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? t("sidebar.projects.createDialog.creating") : t("sidebar.projects.createDialog.create")}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
