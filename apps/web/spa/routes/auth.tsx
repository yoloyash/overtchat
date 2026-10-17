import {
  createRoute,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import {
  fetchSetupRequired,
  sessionQuery,
  twoFactorQuery,
} from "@/lib/queries/auth";
import { withPages } from "@/spa/lazy";
import { authRoute } from "@/spa/routes/root";

const RequiredTwoFactorSetup = lazyRouteComponent(
  () => import("@/components/auth/RequiredTwoFactorSetup"),
  "RequiredTwoFactorSetup",
);

export const loginRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/login",
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (session) throw redirect({ to: "/" });
    if (await fetchSetupRequired()) throw redirect({ to: "/signup" });
  },
  component: lazyRouteComponent(
    () => import("@/components/auth/LoginForm"),
    "LoginForm",
  ),
});

export const signupRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/signup",
  beforeLoad: async () => {
    if (!(await fetchSetupRequired())) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(
    () => import("@/components/auth/SignupForm"),
    "SignupForm",
  ),
});

/** Administrators set up two-factor here first when the server requires it. */
export const twoFactorSetupRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/two-factor-setup",
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (!session) throw redirect({ to: "/login" });
    const status = await context.queryClient.fetchQuery(twoFactorQuery);
    if (!status.required || status.enabled) throw redirect({ to: "/" });
    return { email: session.user.email };
  },
  component: withPages(function TwoFactorSetupPage() {
    const { email } = twoFactorSetupRoute.useRouteContext();
    return <RequiredTwoFactorSetup email={email} />;
  }, RequiredTwoFactorSetup),
});
