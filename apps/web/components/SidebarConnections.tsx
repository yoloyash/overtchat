"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  FolderPlus,
  Loader2,
  Plus,
  TerminalSquare,
} from "lucide-react";
import type {
  AgentConnectionListItem,
  AgentSessionListItem,
  AgentWorkspaceListItem,
} from "@/lib/agents/types";
import { agentProviderMetadata } from "@/lib/agents/catalog";
import {
  AGENT_SESSION_PREVIEW_COUNT,
  visibleAgentSessions,
} from "@/lib/agents/sidebar";
import { useSidebar } from "@/components/sidebar-context";
import { toast } from "@/components/ui/toast";
import { useCreateAgentSession } from "@/lib/queries/agentConnections";
import { cn } from "@/lib/utils";

export function SidebarConnections({
  connections,
}: {
  connections: AgentConnectionListItem[];
}) {
  if (connections.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {connections.map((connection) => (
        <ConnectionNode key={connection.id} connection={connection} />
      ))}
    </ul>
  );
}

function ConnectionNode({
  connection,
}: {
  connection: AgentConnectionListItem;
}) {
  const provider = agentProviderMetadata(connection.provider);
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const hasActiveSession = connection.workspaces.some((workspace) =>
    workspace.sessions.some(
      (session) => pathname === `/agents/${session.id}`,
    ),
  );
  const [open, setOpen] = useState(hasActiveSession);

  return (
    <li>
      <div className="group flex min-w-0 items-center">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={open ? `Collapse ${connection.host.name}` : `Expand ${connection.host.name}`}
          className="rounded p-1 text-muted-foreground motion-colors hover:bg-sidebar-accent max-md:p-2"
        >
          <ChevronRight
            className={cn("size-3.5 motion-transform", open && "rotate-90")}
          />
        </button>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm motion-colors hover:bg-sidebar-accent"
          title={`${connection.host.name} · ${provider.label}`}
        >
          <TerminalSquare className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{connection.host.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {provider.label}
          </span>
        </button>
      </div>
      {open && (
        <div className="ml-5 border-l pl-1">
          {connection.workspaces.map((workspace) => (
            <WorkspaceNode
              key={workspace.id}
              workspace={workspace}
              providerLabel={provider.label}
            />
          ))}
          <Link
            href="/settings/connections"
            onClick={() => setOpenMobile(false)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <FolderPlus className="size-3.5" />
            <span>Add workspace</span>
          </Link>
        </div>
      )}
    </li>
  );
}

function WorkspaceNode({
  workspace,
  providerLabel,
}: {
  workspace: AgentWorkspaceListItem;
  providerLabel: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const createSession = useCreateAgentSession();
  const hasActiveSession = workspace.sessions.some(
    (session) => pathname === `/agents/${session.id}`,
  );
  const [open, setOpen] = useState(hasActiveSession);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const activeSessionId =
    workspace.sessions.find(
      (session) => pathname === `/agents/${session.id}`,
    )?.id ?? null;
  const visibleSessions = visibleAgentSessions(
    workspace.sessions,
    sessionsExpanded,
    activeSessionId,
  );
  const hiddenSessionCount =
    workspace.sessions.length - visibleSessions.length;

  async function startSession() {
    try {
      const id = await createSession.mutateAsync(workspace.id);
      setOpenMobile(false);
      setOpen(true);
      router.push(`/agents/${id}`);
    } catch (cause) {
      toast.error({
        title: `Failed to start ${providerLabel}`,
        description:
          cause instanceof Error ? cause.message : "A new session could not be started.",
      });
    }
  }

  return (
    <div>
      <div className="group flex min-w-0 items-center">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={open ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`}
          className="rounded p-1 text-muted-foreground motion-colors hover:bg-sidebar-accent max-md:p-2"
        >
          <ChevronRight
            className={cn("size-3.5 motion-transform", open && "rotate-90")}
          />
        </button>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm motion-colors hover:bg-sidebar-accent"
          title={workspace.path}
        >
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{workspace.name}</span>
        </button>
        <button
          type="button"
          onClick={() => void startSession()}
          disabled={createSession.isPending}
          aria-label={`New session in ${workspace.name}`}
          title={`New session in ${workspace.name}`}
          className="mr-0.5 rounded p-1 text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50 max-md:p-2"
        >
          {createSession.isPending ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Plus className="size-3.5" />
          )}
        </button>
      </div>
      {open && (
        <ul className="ml-5 flex flex-col gap-0.5 border-l pl-1">
          <li>
            <button
              type="button"
              onClick={() => void startSession()}
              disabled={createSession.isPending}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {createSession.isPending ? (
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Plus className="size-3.5" />
              )}
              <span>New session</span>
            </button>
          </li>
          {visibleSessions.map((session) => (
            <SessionLink key={session.id} session={session} />
          ))}
          {workspace.sessions.length > AGENT_SESSION_PREVIEW_COUNT && (
            <li>
              <button
                type="button"
                onClick={() => setSessionsExpanded((current) => !current)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                {sessionsExpanded ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
                <span>
                  {sessionsExpanded
                    ? "Show less"
                    : `Show ${hiddenSessionCount} more`}
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function SessionLink({ session }: { session: AgentSessionListItem }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const title = session.name || session.firstMessage || "Untitled session";
  return (
    <li>
      <Link
        href={`/agents/${session.id}`}
        onClick={() => setOpenMobile(false)}
        title={title}
        className={cn(
          "flex min-w-0 items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground",
          pathname === `/agents/${session.id}` &&
            "bg-sidebar-accent text-foreground",
        )}
      >
        <span className="truncate">{title}</span>
      </Link>
    </li>
  );
}
