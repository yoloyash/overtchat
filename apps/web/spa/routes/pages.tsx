import {
  createRoute,
  lazyRouteComponent,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Activity, FolderPlus, SquareTerminal } from "lucide-react";
import {
  isAgentProviderId,
  type AgentConnectionListItem,
} from "@overtchat/agent-bridge";
import { SidebarToggle } from "@/components/SidebarToggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { recentAgentSetups } from "@/lib/agents/setups";
import { agentSessionDisplayTitle } from "@/lib/agents/sidebar";
import { agentHostLabel } from "@/lib/agents/workspaces";
import { agentConnectionListQuery } from "@/lib/queries/agentConnections";
import {
  ActivityPending,
  AppPending,
  ChatPending,
} from "@/spa/pending";
import { withPages } from "@/spa/lazy";
import { findInListQuery } from "@/spa/loaders";
import { appRoute } from "@/spa/routes/root";
import { optionalString } from "@/spa/search";

// Each page's code downloads when it is first opened.
const ActivityProfile = lazyRouteComponent(
  () => import("@/components/activity/ActivityProfile"),
  "ActivityProfile",
);
const AgentSessionView = lazyRouteComponent(
  () => import("@/components/agents/AgentSessionView"),
  "AgentSessionView",
);
const NewAgentSessionView = lazyRouteComponent(
  () => import("@/components/agents/NewAgentSessionView"),
  "NewAgentSessionView",
);
const AgentHistoryView = lazyRouteComponent(
  () => import("@/components/agents/AgentHistoryView"),
  "AgentHistoryView",
);
const LibraryBrowser = lazyRouteComponent(
  () => import("@/components/library/LibraryBrowser"),
  "LibraryBrowser",
);
const ScheduledTasksPage = lazyRouteComponent(
  () => import("@/components/scheduled/ScheduledTasksPage"),
  "ScheduledTasksPage",
);
/** Opens a new session with the most recently used agent and workspace. */
export const agentsHomeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/agents",
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/" });
  },
  loader: async ({ context }) => {
    const connections = await context.queryClient.ensureQueryData(
      agentConnectionListQuery,
    );
    const [setup] = recentAgentSetups(connections);
    if (setup) {
      throw redirect({
        to: "/agents/new",
        search: { workspaceId: setup.workspaceId, provider: setup.provider },
        replace: true,
      });
    }
  },
  gcTime: 0,
  pendingComponent: AppPending,
  component: function AgentsHomePage() {
    const { t } = useTranslation();
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header data-titlebar className="flex h-12 shrink-0 items-center gap-2 px-3">
          <SidebarToggle />
          <span className="text-sm font-medium">{t("app.pages.agents.title")}</span>
        </header>
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-sm">
            <SquareTerminal aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
            <h1 className="mt-3 text-xl font-semibold tracking-tight">{t("app.pages.agents.emptyTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("app.pages.agents.emptyDescription")}
            </p>
            <Link
              to="/settings/connections"
              search={{ add: "1" }}
              className={cn(buttonVariants(), "mt-5")}
            >
              <FolderPlus /> {t("app.pages.agents.addWorkspace")}
            </Link>
          </div>
        </div>
      </div>
    );
  },
});

/** Every agent session, searchable by title, message, machine, workspace and agent. */
export const agentHistoryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/agents/history",
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    q?: string;
    host?: string;
    workspace?: string;
    provider?: string;
    sort?: string;
  } => ({
    q: optionalString(search.q),
    host: optionalString(search.host),
    workspace: optionalString(search.workspace),
    provider: optionalString(search.provider),
    sort: optionalString(search.sort),
  }),
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/" });
  },
  pendingComponent: AppPending,
  component: function AgentHistoryPage() {
    const search = agentHistoryRoute.useSearch();
    return <AgentHistoryView search={search} />;
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
    // An unknown setup falls back to the Agents home's choice.
    if (!workspaceId || !provider || !isAgentProviderId(provider)) {
      throw redirect({ to: "/agents", replace: true });
    }
    // The folder may be another agent's record: an agent the machine has
    // starts from any record of the folder, and the server files the session
    // under the agent's own.
    const connection = await findInListQuery(
      context.queryClient,
      agentConnectionListQuery,
      (item) => item.workspaces.some((workspace) => workspace.id === workspaceId),
    );
    const workspace = connection?.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw redirect({ to: "/agents", replace: true });
    return { provider, workspace };
  },
  gcTime: 0,
  pendingComponent: ChatPending,
  component: withPages(
    function NewAgentSessionPage() {
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
    NewAgentSessionView,
  ),
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
    if (!connection || !workspace || !session) {
      throw redirect({ to: "/agents", replace: true });
    }
    return {
      provider: connection.provider,
      hostLabel: agentHostLabel(connection.host),
      workspace,
      initialSessionName: agentSessionDisplayTitle(session) ?? "",
    };
  },
  gcTime: 0,
  pendingComponent: ChatPending,
  component: withPages(
    function AgentSessionPage() {
      const { id } = agentSessionRoute.useParams();
      const { provider, hostLabel, workspace, initialSessionName } =
        agentSessionRoute.useLoaderData();
      return (
        <AgentSessionView
          sessionId={id}
          provider={provider}
          hostLabel={hostLabel}
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          workspacePath={workspace.path}
          initialSessionName={initialSessionName}
        />
      );
    },
    AgentSessionView,
  ),
});

export const libraryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/library",
  pendingComponent: AppPending,
  component: withPages(
    function LibraryPage() {
      const { t } = useTranslation();
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <header data-titlebar className="flex h-12 shrink-0 items-center gap-2 px-3">
            <SidebarToggle />
            <span className="text-sm font-medium">{t("app.pages.library.title")}</span>
          </header>
          <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col">
            <div className="px-4 pb-4 pt-6 sm:px-6">
              <h1 className="text-2xl font-semibold tracking-tight">{t("app.pages.library.title")}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t("app.pages.library.description")}</p>
            </div>
            <LibraryBrowser />
          </div>
        </div>
      );
    },
    LibraryBrowser,
  ),
});

export const scheduledRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/scheduled",
  pendingComponent: AppPending,
  component: withPages(
    function ScheduledPage() {
      const { t } = useTranslation();
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <header data-titlebar className="flex h-12 shrink-0 items-center gap-2 px-3">
            <SidebarToggle />
            <span className="text-sm font-medium">{t("scheduled.page.title")}</span>
          </header>
          <ScheduledTasksPage />
        </div>
      );
    },
    ScheduledTasksPage,
  ),
});

export const activityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activity",
  component: function ActivityLayout() {
    const { t } = useTranslation();
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <header data-titlebar className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarToggle />
          <Activity className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{t("app.pages.activity.title")}</span>
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
  component: lazyRouteComponent(
    () => import("@/components/activity/ActivityLeaderboard"),
    "ActivityLeaderboard",
  ),
});

export const activityProfileRoute = createRoute({
  getParentRoute: () => activityRoute,
  path: "$userId",
  pendingComponent: ActivityPending,
  component: withPages(
    function ActivityProfilePage() {
      const { userId } = activityProfileRoute.useParams();
      return <ActivityProfile userId={userId} />;
    },
    ActivityProfile,
  ),
});
