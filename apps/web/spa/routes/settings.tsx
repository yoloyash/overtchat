import {
  createRoute,
  lazyRouteComponent,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarToggle } from "@/components/SidebarToggle";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { agentConnectionListQuery } from "@/lib/queries/agentConnections";
import {
  availableMcpServersQuery,
  mcpServersQuery,
} from "@/lib/queries/mcpServers";
import { adminModelConfigsQuery } from "@/lib/queries/modelConfigs";
import { serverCapabilitiesQuery } from "@/lib/queries/serverCapabilities";
import { usersQuery } from "@/lib/queries/users";
import { withPages } from "@/spa/lazy";
import { SettingsPending } from "@/spa/pending";
import { findInListQuery } from "@/spa/loaders";
import { appRoute } from "@/spa/routes/root";
import { optionalString } from "@/spa/search";

// Each section's code downloads when it is first opened.
const AccountForm = lazyRouteComponent(
  () => import("@/components/settings/account/AccountForm"),
  "AccountForm",
);
const ConnectionsPanel = lazyRouteComponent(
  () => import("@/components/settings/connections/ConnectionsPanel"),
  "ConnectionsPanel",
);
const ModelEditor = lazyRouteComponent(
  () => import("@/components/settings/models/ModelEditor"),
  "ModelEditor",
);
const ProfileForm = lazyRouteComponent(
  () => import("@/components/settings/profile/ProfileForm"),
  "ProfileForm",
);
const McpServerEditor = lazyRouteComponent(
  () => import("@/components/settings/tools/mcp/McpServerEditor"),
  "McpServerEditor",
);
const ToolsForm = lazyRouteComponent(
  () => import("@/components/settings/tools/ToolsForm"),
  "ToolsForm",
);
const UsersPanel = lazyRouteComponent(
  () => import("@/components/settings/users/UsersPanel"),
  "UsersPanel",
);

export const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: function SettingsLayout() {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <header data-titlebar className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
          <SidebarToggle />
          <span className="text-sm font-semibold tracking-tight">Settings</span>
          <div className="flex-1" />
          <Button
            render={<Link to="/" />}
            variant="ghost"
            size="icon-sm"
            aria-label="Close settings"
          >
            <X />
          </Button>
        </header>
        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          <aside className="shrink-0 overflow-y-auto border-b bg-muted/15 p-3 md:w-52 md:border-r md:border-b-0 md:p-4">
            <SettingsNav />
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-8 md:p-6 md:pb-12 lg:p-8 lg:pb-12">
            <Outlet />
          </div>
        </div>
      </div>
    );
  },
});

/** Settings sections that only administrators can open. */
function requireAdmin({ context }: { context: { isAdmin: boolean } }) {
  if (!context.isAdmin) throw redirect({ to: "/settings/general" });
}

const settingsPage = {
  getParentRoute: () => settingsRoute,
  pendingComponent: SettingsPending,
};

export const settingsIndexRoute = createRoute({
  ...settingsPage,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/general" });
  },
});

export const generalSettingsRoute = createRoute({
  ...settingsPage,
  path: "general",
  component: lazyRouteComponent(
    () => import("@/components/settings/general/GeneralForm"),
    "GeneralForm",
  ),
});

export const accountSettingsRoute = createRoute({
  ...settingsPage,
  path: "account",
  component: withPages(
    function AccountPage() {
      const { session } = accountSettingsRoute.useRouteContext();
      return <AccountForm email={session.user.email} />;
    },
    AccountForm,
  ),
});

export const profileSettingsRoute = createRoute({
  ...settingsPage,
  path: "profile",
  component: withPages(
    function ProfilePage() {
      const { session } = profileSettingsRoute.useRouteContext();
      return (
        <ProfileForm
          userId={session.user.id}
          name={session.user.name}
          image={session.user.image ?? null}
        />
      );
    },
    ProfileForm,
  ),
});

export const personalizationSettingsRoute = createRoute({
  ...settingsPage,
  path: "personalization",
  component: lazyRouteComponent(
    () => import("@/components/settings/personalization/PersonalizationForm"),
    "PersonalizationForm",
  ),
});

export const dataSettingsRoute = createRoute({
  ...settingsPage,
  path: "data",
  component: lazyRouteComponent(
    () => import("@/components/settings/data/DataForm"),
    "DataForm",
  ),
});

export const connectionsSettingsRoute = createRoute({
  ...settingsPage,
  path: "connections",
  validateSearch: (search: Record<string, unknown>): { add?: string } => ({
    add: optionalString(search.add),
  }),
  beforeLoad: requireAdmin,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(agentConnectionListQuery),
  component: withPages(
    function ConnectionsPage() {
      const { add } = connectionsSettingsRoute.useSearch();
      const initialAddOpen = add === "1";
      return (
        <ConnectionsPanel
          key={initialAddOpen ? "add-agent-workspace" : "agents"}
          initialAddOpen={initialAddOpen}
        />
      );
    },
    ConnectionsPanel,
  ),
});

export const modelsSettingsRoute = createRoute({
  ...settingsPage,
  path: "models",
  beforeLoad: requireAdmin,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminModelConfigsQuery),
  component: lazyRouteComponent(
    () => import("@/components/settings/models/ModelsPanel"),
    "ModelsPanel",
  ),
});

export const newModelSettingsRoute = createRoute({
  ...settingsPage,
  path: "models/new",
  beforeLoad: requireAdmin,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminModelConfigsQuery),
  component: withPages(
    function NewModelPage() {
      return <ModelEditor />;
    },
    ModelEditor,
  ),
});

export const modelSettingsRoute = createRoute({
  ...settingsPage,
  path: "models/$id",
  beforeLoad: requireAdmin,
  loader: async ({ context, params }) => {
    const model = await findInListQuery(
      context.queryClient,
      adminModelConfigsQuery,
      (item) => item.id === params.id,
    );
    if (!model) throw redirect({ to: "/settings/models" });
  },
  component: withPages(
    function ModelPage() {
      const { id } = modelSettingsRoute.useParams();
      return <ModelEditor modelId={id} />;
    },
    ModelEditor,
  ),
});

export const servicesSettingsRoute = createRoute({
  ...settingsPage,
  path: "services",
  beforeLoad: requireAdmin,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(serverCapabilitiesQuery),
  component: lazyRouteComponent(
    () => import("@/components/settings/services/ServicesPanel"),
    "ServicesPanel",
  ),
});

export const toolsSettingsRoute = createRoute({
  ...settingsPage,
  path: "tools",
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(availableMcpServersQuery),
      context.isAdmin
        ? context.queryClient.ensureQueryData(mcpServersQuery)
        : undefined,
    ]),
  component: withPages(
    function ToolsPage() {
      const { isAdmin } = toolsSettingsRoute.useRouteContext();
      return <ToolsForm isAdmin={isAdmin} />;
    },
    ToolsForm,
  ),
});

/** MCP server editors only exist for administrators. */
function requireToolsAdmin({ context }: { context: { isAdmin: boolean } }) {
  if (!context.isAdmin) throw redirect({ to: "/settings/tools" });
}

export const newMcpServerSettingsRoute = createRoute({
  ...settingsPage,
  path: "tools/mcp/new",
  beforeLoad: requireToolsAdmin,
  component: withPages(
    function NewMcpServerPage() {
      return <McpServerEditor />;
    },
    McpServerEditor,
  ),
});

export const mcpServerSettingsRoute = createRoute({
  ...settingsPage,
  path: "tools/mcp/$id",
  beforeLoad: requireToolsAdmin,
  loader: async ({ context, params }) => {
    const server = await findInListQuery(
      context.queryClient,
      mcpServersQuery,
      (item) => item.id === params.id,
    );
    if (!server) throw redirect({ to: "/settings/tools" });
    return { server };
  },
  gcTime: 0,
  component: withPages(
    function McpServerPage() {
      const { server } = mcpServerSettingsRoute.useLoaderData();
      return <McpServerEditor server={server} />;
    },
    McpServerEditor,
  ),
});

export const usersSettingsRoute = createRoute({
  ...settingsPage,
  path: "users",
  beforeLoad: requireAdmin,
  loader: ({ context }) => context.queryClient.ensureQueryData(usersQuery),
  component: withPages(
    function UsersPage() {
      const { session } = usersSettingsRoute.useRouteContext();
      return <UsersPanel currentUserId={session.user.id} />;
    },
    UsersPanel,
  ),
});
