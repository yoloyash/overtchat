import { createRoute, redirect } from "@tanstack/react-router";
import { LoginForm } from "@/components/auth/LoginForm";
import { SignupForm } from "@/components/auth/SignupForm";
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
  component: LoginForm,
});

export const signupRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/signup",
  beforeLoad: async () => {
    if (!(await fetchSetupRequired())) throw redirect({ to: "/login" });
  },
  component: SignupForm,
});
