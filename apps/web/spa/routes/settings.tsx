import { createRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarToggle } from "@/components/SidebarToggle";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { AccountForm } from "@/components/settings/account/AccountForm";
import { ConnectionsPanel } from "@/components/settings/connections/ConnectionsPanel";
import { DataForm } from "@/components/settings/data/DataForm";
import { GeneralForm } from "@/components/settings/general/GeneralForm";
import { ModelEditor } from "@/components/settings/models/ModelEditor";
import { ModelsPanel } from "@/components/settings/models/ModelsPanel";
import { PersonalizationForm } from "@/components/settings/personalization/PersonalizationForm";
import { ProfileForm } from "@/components/settings/profile/ProfileForm";
import { ServicesPanel } from "@/components/settings/services/ServicesPanel";
import { McpServerEditor } from "@/components/settings/tools/mcp/McpServerEditor";
import { ToolsForm } from "@/components/settings/tools/ToolsForm";
import { UsersPanel } from "@/components/settings/users/UsersPanel";
import { agentConnectionListQuery } from "@/lib/queries/agentConnections";
import {
  availableMcpServersQuery,
  mcpServersQuery,
} from "@/lib/queries/mcpServers";
import { adminModelConfigsQuery } from "@/lib/queries/modelConfigs";
import { serverCapabilitiesQuery } from "@/lib/queries/serverCapabilities";
import { usersQuery } from "@/lib/queries/users";
import { SettingsPending } from "@/spa/pending";
import { findInListQuery } from "@/spa/loaders";
import { appRoute } from "@/spa/routes/root";
import { optionalString } from "@/spa/search";

export const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: function SettingsLayout() {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
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
  component: GeneralForm,
});

export const accountSettingsRoute = createRoute({
  ...settingsPage,
  path: "account",
  component: function AccountPage() {
    const { session } = accountSettingsRoute.useRouteContext();
    return <AccountForm email={session.user.email} />;
  },
});

export const profileSettingsRoute = createRoute({
  ...settingsPage,
  path: "profile",
  component: function ProfilePage() {
    const { session } = profileSettingsRoute.useRouteContext();
    return (
      <ProfileForm
        userId={session.user.id}
        name={session.user.name}
        image={session.user.image ?? null}
      />
    );
  },
});

export const personalizationSettingsRoute = createRoute({
  ...settingsPage,
  path: "personalization",
  component: PersonalizationForm,
});

export const dataSettingsRoute = createRoute({
  ...settingsPage,
  path: "data",
  component: DataForm,
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
  component: function ConnectionsPage() {
    const { add } = connectionsSettingsRoute.useSearch();
    const initialAddOpen = add === "1";
    return (
      <ConnectionsPanel
        key={initialAddOpen ? "add-agent-workspace" : "agents"}
        initialAddOpen={initialAddOpen}
      />
    );
  },
});

export const modelsSettingsRoute = createRoute({
  ...settingsPage,
  path: "models",
  beforeLoad: requireAdmin,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminModelConfigsQuery),
  component: ModelsPanel,
});

export const newModelSettingsRoute = createRoute({
  ...settingsPage,
  path: "models/new",
  beforeLoad: requireAdmin,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminModelConfigsQuery),
  component: function NewModelPage() {
    return <ModelEditor />;
  },
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
  component: function ModelPage() {
    const { id } = modelSettingsRoute.useParams();
    return <ModelEditor modelId={id} />;
  },
});

export const servicesSettingsRoute = createRoute({
  ...settingsPage,
  path: "services",
  beforeLoad: requireAdmin,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(serverCapabilitiesQuery),
  component: ServicesPanel,
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
  component: function ToolsPage() {
    const { isAdmin } = toolsSettingsRoute.useRouteContext();
    return <ToolsForm isAdmin={isAdmin} />;
  },
});

/** MCP server editors only exist for administrators. */
function requireToolsAdmin({ context }: { context: { isAdmin: boolean } }) {
  if (!context.isAdmin) throw redirect({ to: "/settings/tools" });
}

export const newMcpServerSettingsRoute = createRoute({
  ...settingsPage,
  path: "tools/mcp/new",
  beforeLoad: requireToolsAdmin,
  component: function NewMcpServerPage() {
    return <McpServerEditor />;
  },
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
  component: function McpServerPage() {
    const { server } = mcpServerSettingsRoute.useLoaderData();
    return <McpServerEditor server={server} />;
  },
});

export const usersSettingsRoute = createRoute({
  ...settingsPage,
  path: "users",
  beforeLoad: requireAdmin,
  loader: ({ context }) => context.queryClient.ensureQueryData(usersQuery),
  component: function UsersPage() {
    const { session } = usersSettingsRoute.useRouteContext();
    return <UsersPanel currentUserId={session.user.id} />;
  },
});
