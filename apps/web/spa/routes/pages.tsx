import { createRoute, Outlet, redirect } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import {
  isAgentProviderId,
  type AgentConnectionListItem,
} from "@overtchat/agent-bridge";
import { ActivityLeaderboard } from "@/components/activity/ActivityLeaderboard";
import { ActivityProfile } from "@/components/activity/ActivityProfile";
import { AgentSessionView } from "@/components/agents/AgentSessionView";
import { NewAgentSessionView } from "@/components/agents/NewAgentSessionView";
import { LibraryBrowser } from "@/components/library/LibraryBrowser";
import { ProjectPanel } from "@/components/projects/ProjectPanel";
import { SidebarToggle } from "@/components/SidebarToggle";
import { agentSessionDisplayTitle } from "@/lib/agents/sidebar";
import { agentConnectionListQuery } from "@/lib/queries/agentConnections";
import { fetchProject, projectQuery } from "@/lib/queries/projects";
import {
  ActivityPending,
  AppPending,
  ChatPending,
  ProjectPending,
} from "@/spa/pending";
import { findInListQuery } from "@/spa/loaders";
import { appRoute } from "@/spa/routes/root";
import { optionalString } from "@/spa/search";

export const projectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$id",
  loader: async ({ context, params }) => {
    const project = await fetchProject(params.id);
    if (!project) throw redirect({ to: "/" });
    context.queryClient.setQueryData(projectQuery(params.id).queryKey, project);
  },
  pendingComponent: ProjectPending,
  component: function ProjectPage() {
    const { id } = projectRoute.useParams();
    return <ProjectPanel projectId={id} />;
  },
});

export const newAgentSessionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/agents/new",
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    workspaceId?: string;
    provider?: string;
    fork?: string;
    chooseWorkspace?: string;
  } => ({
    workspaceId: optionalString(search.workspaceId),
    provider: optionalString(search.provider),
    fork: optionalString(search.fork),
    chooseWorkspace: optionalString(search.chooseWorkspace),
  }),
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/" });
  },
  loaderDeps: ({ search: { workspaceId, provider } }) => ({ workspaceId, provider }),
  loader: async ({ context, deps: { workspaceId, provider } }) => {
    if (!workspaceId || !provider || !isAgentProviderId(provider)) {
      throw redirect({ to: "/" });
    }
    const connection = await findInListQuery(
      context.queryClient,
      agentConnectionListQuery,
      (item) => item.workspaces.some((workspace) => workspace.id === workspaceId),
    );
    const workspace = connection?.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw redirect({ to: "/" });
    return { provider, workspace };
  },
  gcTime: 0,
  pendingComponent: ChatPending,
  component: function NewAgentSessionPage() {
    const { provider, workspace } = newAgentSessionRoute.useLoaderData();
    const { fork, chooseWorkspace } = newAgentSessionRoute.useSearch();
    return (
      <NewAgentSessionView
        key={`${workspace.id}:${provider}:${fork ?? ""}`}
        provider={provider}
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        workspacePath={workspace.path}
        forkId={fork ?? null}
        chooseWorkspace={chooseWorkspace === "1"}
      />
    );
  },
});

export const agentSessionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/agents/$id",
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/" });
  },
  loader: async ({ context, params }) => {
    const hasSession = (connection: AgentConnectionListItem) =>
      connection.workspaces.some((workspace) =>
        workspace.sessions.some((session) => session.id === params.id),
      );
    const connection = await findInListQuery(
      context.queryClient,
      agentConnectionListQuery,
      hasSession,
    );
    const workspace = connection?.workspaces.find((item) =>
      item.sessions.some((session) => session.id === params.id),
    );
    const session = workspace?.sessions.find((item) => item.id === params.id);
    if (!connection || !workspace || !session) throw redirect({ to: "/" });
    return {
      provider: connection.provider,
      workspace,
      initialSessionName: agentSessionDisplayTitle(session) ?? "",
    };
  },
  gcTime: 0,
  pendingComponent: ChatPending,
  component: function AgentSessionPage() {
    const { id } = agentSessionRoute.useParams();
    const { provider, workspace, initialSessionName } =
      agentSessionRoute.useLoaderData();
    return (
      <AgentSessionView
        sessionId={id}
        provider={provider}
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        workspacePath={workspace.path}
        initialSessionName={initialSessionName}
      />
    );
  },
});

export const libraryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/library",
  pendingComponent: AppPending,
  component: function LibraryPage() {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 px-3">
          <SidebarToggle />
          <span className="text-sm font-medium">Library</span>
        </header>
        <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col">
          <div className="px-4 pb-4 pt-6 sm:px-6">
            <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
            <p className="mt-2 text-sm text-muted-foreground">Files from your saved chats. Reuse them with “Add from library” in any chat.</p>
          </div>
          <LibraryBrowser />
        </div>
      </div>
    );
  },
});

export const activityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activity",
  component: function ActivityLayout() {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarToggle />
          <Activity className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Activity</span>
        </header>
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    );
  },
});

export const activityIndexRoute = createRoute({
  getParentRoute: () => activityRoute,
  path: "/",
  pendingComponent: ActivityPending,
  component: ActivityLeaderboard,
});

export const activityProfileRoute = createRoute({
  getParentRoute: () => activityRoute,
  path: "$userId",
  pendingComponent: ActivityPending,
  component: function ActivityProfilePage() {
    const { userId } = activityProfileRoute.useParams();
    return <ActivityProfile userId={userId} />;
  },
});
