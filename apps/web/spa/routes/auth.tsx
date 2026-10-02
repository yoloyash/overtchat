import {
  createRoute,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { fetchSetupRequired, sessionQuery } from "@/lib/queries/auth";
import { authRoute } from "@/spa/routes/root";

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
