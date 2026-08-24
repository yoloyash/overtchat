"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  Activity,
  Check,
  FolderPlus,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  RefreshCw,
  Search,
} from "lucide-react";
import type { AgentProviderId } from "@overtchat/agent-bridge";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import { SidebarChatList } from "@/components/SidebarChatList";
import {
  SidebarProjects,
  CreateProjectDialog,
} from "@/components/SidebarProjects";
import { SidebarAgentWorkspaces } from "@/components/SidebarAgentWorkspaces";
import { useSidebar } from "@/components/sidebar-context";
import { useChats } from "@/lib/queries/chats";
import { useProjects } from "@/lib/queries/projects";
import {
  useAgentConnectionSessionDirectory,
  useAgentConnections,
  useRefreshAllAgentWorkspaces,
} from "@/lib/queries/agentConnections";
import { LinkPendingIndicator } from "@/components/ui/link-pending-indicator";
import { toast } from "@/components/ui/toast";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function SidebarClient({ isAdmin }: { isAdmin: boolean }) {
  const { closeMobile, closeSidebar, openPalette } = useSidebar();
  const [creatingProject, setCreatingProject] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const { data: chats = [] } = useChats();
  const { data: projects = [] } = useProjects();

  const projectOptions = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name })),
    [projects],
  );

  const unprojected = useMemo(
    () =>
      chats
        .filter((c) => c.projectId == null)
        .map((c) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt,
        })),
    [chats],
  );

  const projectsWithChats = useMemo(() => {
    const byProject = new Map<string, { id: string; title: string | null }[]>();
    for (const c of chats) {
      if (!c.projectId) continue;
      const list = byProject.get(c.projectId) ?? [];
      list.push({ id: c.id, title: c.title });
      byProject.set(c.projectId, list);
    }
    return projectOptions.map((p) => ({
      ...p,
      chats: byProject.get(p.id) ?? [],
    }));
  }, [chats, projectOptions]);

  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <span className="font-brand text-sm font-semibold tracking-tight">overtchat</span>
        <button
          type="button"
          onClick={closeSidebar}
          aria-label="Collapse sidebar"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground max-md:p-2.5"
        >
          <PanelLeft className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <nav className="flex flex-col gap-0.5 py-1">
          <Link
            href="/"
            onClick={(e) => {
              closeMobile();
              if (pathname === "/") {
                e.preventDefault();
                router.refresh();
              }
            }}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm motion-colors hover:bg-sidebar-accent"
          >
            <Pencil className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">New chat</span>
            <Shortcut keys={["Ctrl", "Shift", "O"]} />
            <LinkPendingIndicator />
          </Link>
          <button
            type="button"
            onClick={() => {
              closeMobile();
              openPalette();
            }}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm motion-colors hover:bg-sidebar-accent"
          >
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-left">Search chats</span>
            <Shortcut keys={["Ctrl", "K"]} />
          </button>
          <Link
            href="/activity"
            onClick={closeMobile}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm motion-colors hover:bg-sidebar-accent",
              pathname.startsWith("/activity") && "bg-sidebar-accent",
            )}
          >
            <Activity className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">Activity</span>
            <LinkPendingIndicator />
          </Link>
        </nav>

        <SectionLabel>Projects</SectionLabel>
        <SidebarProjects projects={projectsWithChats} />
        <button
          type="button"
          onClick={() => setCreatingProject(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <FolderPlus className="size-4 shrink-0" />
          <span>New project</span>
        </button>

        {isAdmin && <AdminAgentWorkspaces />}

        <SidebarChatList chats={unprojected} projects={projectOptions} />
      </div>

      <CreateProjectDialog
        open={creatingProject}
        onClose={() => setCreatingProject(false)}
      />
    </>
  );
}

function AdminAgentWorkspaces() {
  const { data: connections = [] } = useAgentConnections();
  const refresh = useRefreshAllAgentWorkspaces();
  useAgentConnectionSessionDirectory(connections);
  const { closeMobile, drawerRef } = useSidebar();
  const [providerFilter, setProviderFilter] = useState<AgentProviderId | null>(
    null,
  );
  const hasWorkspaces = connections.some(
    (connection) => connection.workspaces.length > 0,
  );
  const providers = useMemo(
    () =>
      [...new Set(
        connections
          .filter((connection) => connection.workspaces.length > 0)
          .map((connection) => connection.provider),
      )].sort(),
    [connections],
  );
  const activeProviderFilter =
    providerFilter && providers.includes(providerFilter)
      ? providerFilter
      : null;

  if (!hasWorkspaces) return null;

  async function refreshAllChats() {
    try {
      const result = await refresh.mutateAsync(connections);
      const synced = result.created + result.refreshed;
      if (synced === 0) {
        toast.error({
          title: "Chats could not be refreshed",
          description: result.failures[0]?.message,
        });
      } else if (result.failures.length > 0) {
        toast.warning({
          title: "Chats refreshed with some errors",
          description: `${synced} agent workspace${synced === 1 ? "" : "s"} synced; ${result.failures.length} failed.`,
        });
      } else {
        toast.success({
          title: "Chats refreshed",
          description: `${synced} agent workspace${synced === 1 ? "" : "s"} synced.`,
        });
      }
    } catch (error) {
      toast.error({
        title: "Chats could not be refreshed",
        description:
          error instanceof Error ? error.message : "Refresh failed.",
      });
    }
  }

  return (
    <>
      <SectionLabel
        action={
          <span className="flex items-center gap-0.5">
            <Menu.Root>
              <Menu.Trigger
                aria-label={
                  activeProviderFilter
                    ? `Agent workspace options, filtered by ${agentProviderMetadata(activeProviderFilter).label}`
                    : "Agent workspace options"
                }
                title={
                  activeProviderFilter
                    ? `Workspace options · Filtered by ${agentProviderMetadata(activeProviderFilter).label}`
                    : "Workspace options"
                }
                className={cn(
                  "relative flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground",
                  activeProviderFilter && "bg-sidebar-accent text-foreground",
                )}
              >
                <MoreHorizontal className="size-3.5" />
                {activeProviderFilter && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
                  />
                )}
              </Menu.Trigger>
              <Menu.Portal container={drawerRef}>
                <Menu.Positioner side="bottom" align="end" sideOffset={6}>
                  <Menu.Popup
                    className={cn(
                      "z-50 w-48 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                      motionClasses.popup,
                    )}
                  >
                    {providers.length > 1 && (
                      <>
                        <Menu.Group>
                          <Menu.GroupLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                            Show chats from
                          </Menu.GroupLabel>
                          <Menu.RadioGroup
                            value={activeProviderFilter ?? "all"}
                            onValueChange={(value) =>
                              setProviderFilter(
                                value === "all"
                                  ? null
                                  : (value as AgentProviderId),
                              )
                            }
                          >
                            <ProviderFilterMenuItem value="all" label="All agents" />
                            {providers.map((provider) => (
                              <ProviderFilterMenuItem
                                key={provider}
                                value={provider}
                                label={agentProviderMetadata(provider).label}
                              />
                            ))}
                          </Menu.RadioGroup>
                        </Menu.Group>
                        <Menu.Separator className="mx-1 my-1 h-px bg-border" />
                      </>
                    )}
                    <Menu.Item
                      disabled={refresh.isPending}
                      onClick={() => void refreshAllChats()}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                    >
                      <RefreshCw
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground",
                          refresh.isPending &&
                            "animate-spin motion-reduce:animate-none",
                        )}
                      />
                      <span>Refresh all chats</span>
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
            <Link
              href="/settings/connections?add=1"
              onClick={closeMobile}
              aria-label="Add workspace"
              title="Add workspace"
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <FolderPlus className="size-3.5" />
            </Link>
          </span>
        }
      >
        Agent workspaces
      </SectionLabel>
      <SidebarAgentWorkspaces
        connections={connections}
        providerFilter={activeProviderFilter}
      />
    </>
  );
}

function ProviderFilterMenuItem({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <Menu.RadioItem
      value={value}
      closeOnClick
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
    >
      <span>{label}</span>
      <span className="ml-auto flex size-4 items-center justify-center">
        <Menu.RadioItemIndicator>
          <Check className="size-3.5" />
        </Menu.RadioItemIndicator>
      </span>
    </Menu.RadioItem>
  );
}

function SectionLabel({
  children,
  badge,
  action,
}: {
  children: React.ReactNode;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mt-4 mb-1 flex min-h-6 items-center gap-2 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {children}
        </span>
        {badge}
      </div>
      {action}
    </div>
  );
}

function Shortcut({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground opacity-0 motion-opacity group-hover:opacity-100">
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded border border-sidebar-border bg-sidebar-accent/50 px-1 py-px font-sans leading-none"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
