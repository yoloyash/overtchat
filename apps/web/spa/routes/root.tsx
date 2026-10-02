import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { DesktopServer } from "@/components/auth/DesktopServer";
import { Sidebar } from "@/components/Sidebar";
import { activeChatIdsQuery, chatListQuery } from "@/lib/queries/chats";
import { projectListQuery } from "@/lib/queries/projects";
import { agentConnectionListQuery } from "@/lib/queries/agentConnections";
import { sessionQuery } from "@/lib/queries/auth";

export type RouterContext = { queryClient: QueryClient };

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
});

/** Signed-out pages: login and first-run signup. */
export const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "auth",
  component: AuthLayout,
});

/** Everything behind sign-in, rendered inside the sidebar shell. */
export const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (!session) throw redirect({ to: "/login" });
    return { session, isAdmin: session.user.role === "admin" };
  },
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(chatListQuery),
      context.queryClient.ensureQueryData(activeChatIdsQuery),
      context.queryClient.ensureQueryData(projectListQuery),
      context.isAdmin
        ? context.queryClient.ensureQueryData(agentConnectionListQuery)
        : undefined,
    ]),
  component: AppLayout,
});

function AuthLayout() {
  return (
    <AuthFrame footer={<DesktopServer />}>
      <Outlet />
    </AuthFrame>
  );
}

function AppLayout() {
  const { isAdmin } = appRoute.useRouteContext();
  return (
    <AppShell sidebar={<Sidebar isAdmin={isAdmin} />}>
      <Outlet />
    </AppShell>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <Link to="/" className="text-sm text-muted-foreground underline underline-offset-4">
        Back to chats
      </Link>
    </div>
  );
}
